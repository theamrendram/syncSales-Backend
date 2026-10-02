/**
 * Better Auth instance — the single source of identity for the whole product.
 */
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin, organization } from "better-auth/plugins";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";

import prisma from "../utils/prismaClient.js";
import logger from "../utils/logger.js";
import { sendEmail } from "./email/index.js";
import {
  verifyEmailTemplate,
  resetPasswordTemplate,
  organizationInviteTemplate,
} from "./email/templates.js";
import { ORG_ROLES, DEFAULT_ROLE } from "./org-roles.js";
import { DEFAULT_ORG_ROLES } from "../utils/default-org-roles.js";
import { generateKey } from "../utils/generate-key.js";
import { upsertMembership } from "./membership.js";

const APP_URL = process.env.APP_URL || "http://localhost:3000";
const CRM_URL = process.env.CRM_URL || "http://localhost:3001";
const BASE_URL = process.env.BETTER_AUTH_URL || "http://localhost:8000";

/**
 * Who may impersonate another user.
 *
 * Deliberately from the environment rather than from User.role. Impersonation
 * is full account takeover, so the list of people who can do it should not be
 * grantable by a single UPDATE on a row — a database write should not be able
 * to escalate anyone to it. Empty by default: no list, no impersonation.
 */
const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

/**
 * The same people, named by email.
 *
 * Two lists for one decision looks redundant, but they fail differently. Ids are
 * what the admin plugin checks, and they are not stable across environments — a
 * database reseed hands every user a new uuid, and ADMIN_USER_IDS then points at
 * a row that no longer exists, which fails *open* in the sense that the intended
 * admin silently loses access while a recycled id could in principle gain it.
 * Emails survive a reseed. Checking both means a stale entry in either list
 * denies rather than grants.
 */
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

/**
 * Cookies are shared across syncsales.in and its subdomains so one sign-in on
 * the marketing site also authenticates the CRM. Left unset in development,
 * where the apps are localhost ports and a domain attribute would break them.
 */
const COOKIE_DOMAIN = process.env.AUTH_COOKIE_DOMAIN || null;

/**
 * Better Auth builds action links against this API's own origin, and a
 * `callbackURL` that is relative — the default is "/" — therefore resolves to
 * the API too. Following one lands the user on the API root instead of the app.
 *
 * Relative callbacks are rebased onto the frontend; absolute ones a caller
 * supplied deliberately are left alone.
 */
function withAppCallback(rawUrl, fallbackPath = "/") {
  try {
    const url = new URL(rawUrl);
    const cb = url.searchParams.get("callbackURL");
    // Better Auth always sets a callbackURL, defaulting it to "/", so a bare
    // "/" means the caller did not choose one — use the fallback, which can say
    // what just happened. Any other relative path is the caller's, rebased.
    const target = !cb || cb === "/" ? fallbackPath : cb;
    if (!cb || cb.startsWith("/")) {
      url.searchParams.set("callbackURL", new URL(target, APP_URL).toString());
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

export const auth = betterAuth({
  appName: "SyncSales",
  baseURL: BASE_URL,
  secret: process.env.BETTER_AUTH_SECRET,

  database: prismaAdapter(prisma, { provider: "postgresql" }),
  user: {
    additionalFields: {
      firstName: { type: "string", required: false, input: false },
      lastName: { type: "string", required: false, input: false },
      apiKey: { type: "string", required: false, input: false },
    },
  },

  session: {
    // Avoids a session lookup on every request; the cookie carries a signed
    // snapshot for this long before the database is consulted again.
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      const { subject, html } = resetPasswordTemplate({
        name: user.name,
        url: withAppCallback(url, "/auth?reset=done"),
      });
      await sendEmail({ to: user.email, subject, html });
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      const { subject, html } = verifyEmailTemplate({
        name: user.name,
        url: withAppCallback(url, "/auth?verified=1"),
      });
      await sendEmail({ to: user.email, subject, html });
    },
  },

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    },
  },

  account: {
    // Lets the two existing production users sign in with Google and land on
    // their current User row instead of a duplicate. Safe only because Google
    // verifies email ownership; do not add an unverified provider here.
    accountLinking: { enabled: true, trustedProviders: ["google"] },
  },

  advanced: {
    crossSubDomainCookies: COOKIE_DOMAIN
      ? { enabled: true, domain: COOKIE_DOMAIN }
      : { enabled: false },
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  },
  trustedOrigins: [APP_URL, CRM_URL],

  databaseHooks: {
    session: {
      create: {
        // Session.impersonatedBy is the only trace that a session is not really
        // the user acting. A column nobody reads is not an audit trail, so every
        // impersonated session is announced here, where the log pipeline already
        // ships and retains it.
        after: async (session) => {
          if (session.impersonatedBy) {
            logger.warn(
              {
                evt: "impersonation_started",
                adminUserId: session.impersonatedBy,
                targetUserId: session.userId,
                sessionExpiresAt: session.expiresAt,
              },
              "admin impersonation session created",
            );
          }
        },
      },
    },
    user: {
      create: {
        // Better Auth only knows `name`, but the rest of the codebase reads
        // firstName/lastName everywhere (lead attribution, webmaster listings,
        // CSV exports). Split once, here, so no downstream code has to care
        // which system created the row.
        before: async (user) => {
          const parts = String(user.name || "").trim().split(/\s+/).filter(Boolean);
          return {
            data: {
              ...user,
              ...(user.firstName || user.lastName
                ? {}
                : {
                  firstName: parts[0] || "",
                  lastName: parts.slice(1).join(" ") || "",
                }),
              // User.apiKey is `@unique @default("0")` and Better Auth never
              // sets it, so without this every account it creates would take
              // the literal default "0" — the first signup succeeds and the
              // second dies on the unique index, reported only as the generic
              // "Failed to create user".
              ...(user.apiKey ? {} : { apiKey: generateKey() }),
            },
          };
        },
      },
    },
  },

  plugins: [
    organization({
      // Membership and invitations come from the plugin. Permissions do not:
      // role names index into src/lib/org-roles.js, so requireOrgPermission()
      // and every route that calls it keep working untouched.
      schema: {
        // The plugin reads and writes OrganizationMember directly rather than a
        // Member table of its own. That is the whole point of storing the role as
        // a name: the plugin expects one, and cannot be pointed at a uuid foreign
        // key. `createdAt` is this table's `joinedAt`.
        member: {
          // The Prisma *client property*, not the model name. The adapter
          // introspects the generated client and lowercases each model's first
          // letter, so "OrganizationMember" never matches "organizationMember" —
          // it reports the table as missing and getSession() then throws
          // SCHEMA_MISMATCH, which 401s every authenticated request.
          modelName: "organizationMember",
          fields: { createdAt: "joinedAt" },
        },
        organization: {
          // Same stripping rule as User.additionalFields above: without this
          // declaration, the ownerId injected by beforeCreateOrganization is
          // discarded before the INSERT and the column lands NULL.
          additionalFields: {
            ownerId: { type: "string", required: false, input: false },
          },
        },
      },
      roles: ORG_ROLES,
      creatorRole: "owner",
      defaultRole: DEFAULT_ROLE,
      organizationHooks: {
        // The plugin does not know about Organization.ownerId, which billing
        // entitlement hangs off (UserPlan and Subscription attach to the org
        // owner). Setting it in the same insert keeps the column and its
        // unique constraint truthful rather than relying on a later update.
        beforeCreateOrganization: async ({ organization, user }) => {
          // ownerId is @unique, so a second organization would fail on the
          // index with an opaque database error. Fail with a readable one.
          const existing = await prisma.organization.findUnique({
            where: { ownerId: user.id },
            select: { id: true },
          });
          if (existing) {
            throw new APIError("BAD_REQUEST", {
              code: "ORGANIZATION_ALREADY_OWNED",
              message: "You already own an organization",
            });
          }
          return { data: { ...organization, ownerId: user.id } };
        },

        // The permission layer (authentication-context.middleware.js) still
        // reads Role and OrganizationMember, which the plugin knows nothing
        // about. Until that read moves to Member, an organization created
        // through the plugin would leave its owner with no permissions at all.
        // Seeding both here keeps the two representations in step.
        afterCreateOrganization: async ({ organization, user }) => {
          try {
            await prisma.$transaction(async (tx) => {
              await tx.role.createMany({
                data: DEFAULT_ORG_ROLES.map((role) => ({
                  ...role,
                  organizationId: organization.id,
                })),
                skipDuplicates: true,
              });

              // Membership goes through the shared helper, which also fills
              // User.organizationId — the only organization the API-key path can
              // see, since it has no session to carry an active one.
              await upsertMembership({
                client: tx,
                userId: user.id,
                organizationId: organization.id,
                role: "owner",
              });
            });
          } catch (err) {
            // The organization and its Member row already exist; failing here
            // would leave the caller thinking nothing was created. Log loudly
            // instead — the backfill script can repair the legacy rows.
            logger.error(
              { err, organizationId: organization.id },
              "failed to seed legacy role/member rows for new organization",
            );
          }
        },
      },
      sendInvitationEmail: async ({ email, organization, inviter, id }) => {
        const url = `${APP_URL}/accept-invitation/${id}`;
        const { subject, html } = organizationInviteTemplate({
          organizationName: organization.name,
          inviterName: inviter?.user?.name,
          url,
        });
        await sendEmail({ to: email, subject, html });
      },
    }),

    // Impersonation, the replacement for the previous provider's "sign in as
    // user". POST /api/auth/admin/impersonate-user swaps the caller's session
    // cookie for one belonging to the target, and /admin/stop-impersonating
    // puts it back. Nothing downstream needs to know: requireAuth() reads the
    // session as usual, so the whole API acts as that user.
    //
    // Session.impersonatedBy holds the acting admin's id and is the only record
    // that a session is not really the user, which is why it is logged below.
    admin({
      adminUserIds: ADMIN_USER_IDS,
      // Shorter than a normal session on purpose. An impersonated session is a
      // support tool, not a place to live, and it should lapse on its own if
      // someone forgets to stop.
      impersonationSessionDuration: 60 * 30,
    }),
  ],

  hooks: {
    /**
     * Independent check on every /admin/* endpoint.
     *
     * The admin plugin already gates these on ADMIN_USER_IDS. This does not
     * replace that — it runs before it and asserts the caller's *email* is on
     * ADMIN_EMAILS too, so both must agree. The plugin's list is the one that
     * grants; this one can only take away.
     *
     * Why bother: the two lists fail in different directions, and an
     * impersonated session must never be able to impersonate onward. A borrowed
     * session's email is the target's, so it is refused here even if the target
     * later appeared in ADMIN_USER_IDS.
     */
    before: createAuthMiddleware(async (ctx) => {
      if (!ctx.path?.startsWith("/admin/")) return;

      // The one /admin/* path that must stay open to a non-admin session.
      // Stopping is how a borrowed session gets back to being the admin's, and
      // by definition the caller's email is the target's at that moment — every
      // check below would refuse it and strand whoever is impersonating. The
      // endpoint itself is already safe: it only works on a session that carries
      // impersonatedBy, and it can only return you to the admin who set it.
      if (ctx.path === "/admin/stop-impersonating") return;

      const session = await getSessionFromCtx(ctx).catch(() => null);
      const email = String(session?.user?.email || "").toLowerCase();

      if (!email || !ADMIN_EMAILS.includes(email)) {
        logger.warn(
          { evt: "admin_endpoint_denied", path: ctx.path, email: email || null },
          "admin endpoint refused: caller not in ADMIN_EMAILS",
        );
        throw new APIError("NOT_FOUND", {
          code: "NOT_FOUND",
          message: "Not found",
        });
      }

      if (session?.session?.impersonatedBy) {
        logger.warn(
          { evt: "admin_endpoint_denied", path: ctx.path, email },
          "admin endpoint refused: session is impersonated",
        );
        throw new APIError("FORBIDDEN", {
          code: "IMPERSONATED_SESSION",
          message: "Not allowed while impersonating",
        });
      }
    }),
  },

  onAPIError: {
    onError: (error) => {
      logger.error({ err: error }, "better-auth error");
    },
  },
});

export default auth;
