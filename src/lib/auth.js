/**
 * Better Auth instance — the single source of identity for the whole product.
 */
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin, organization } from "better-auth/plugins";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";

import prisma from "../utils/core/prismaClient.js";
import logger from "../utils/core/logger.js";
import { sendEmail } from "./email/index.js";
import {
  verifyEmailTemplate,
  resetPasswordTemplate,
  organizationInviteTemplate,
} from "./email/templates.js";
import { DEFAULT_ROLE, isNarrowedRole } from "./org-roles.js";
import {
  parseGrants,
  hasAnyGrant,
  grantsBelongToOrg,
  grantsStillInOrg,
  replaceGrants,
} from "./member-grants.js";
import { ac, PLUGIN_ROLES, ASSIGNABLE_ROLES } from "./org-access-control.js";
import { DEFAULT_ORG_ROLES } from "../utils/access/default-org-roles.js";
import { upsertMembership } from "./membership.js";
import { assertMemberAuthAllowed, getMemberAuthPolicy } from "./member-auth-policy.js";
import { invitationSignup } from "./invitation-signup.js";
import { assertSeatAvailable } from "./member-limit.js";

const APP_URL = process.env.NODE_ENV === "production" ? process.env.APP_URL : "http://localhost:3000";
const CRM_URL = process.env.NODE_ENV === "production" ? process.env.CRM_URL : "http://localhost:3001";
const BASE_URL = process.env.NODE_ENV === "production" ? process.env.BETTER_AUTH_URL : "http://localhost:8000";

/**
 * Who may impersonate another user.
 *
 * Deliberately from the environment rather than from User.role. Impersonation
 * is full account takeover, so the list of people who can do it should not be
 * grantable by a single UPDATE on a row — a database write should not be able
 * to escalate anyone to it. Empty by default: no list, no impersonation.
 */
const ADMIN_USER_IDS = (process.env.NODE_ENV === "production" ? process.env.ADMIN_USER_IDS : "")
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
const ADMIN_EMAILS = (process.env.NODE_ENV === "production" ? process.env.ADMIN_EMAILS : "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

/**
 * Cookies are shared across syncsales.in and its subdomains so one sign-in on
 * the marketing site also authenticates the CRM. Left unset in development,
 * where the apps are localhost ports and a domain attribute would break them.
 */
const COOKIE_DOMAIN = process.env.NODE_ENV === "production" ? process.env.AUTH_COOKIE_DOMAIN : null;

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
      // The endpoint answers the same whether or not an email goes out, so
      // suppressing it here gates the reset without telling the caller which
      // addresses belong to members who may not reset.
      const policy = await getMemberAuthPolicy(user.id);
      if (!policy.canManagePassword) {
        logger.info(
          { evt: "reset_password_suppressed", userId: user.id },
          "password reset email not sent: disabled for organization members",
        );
        return;
      }
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
    account: {
      create: {
        // Every way an account row appears — /link-social, the implicit Google
        // linking on sign-in (accountLinking.trustedProviders), setPassword and
        // /reset-password for a user with no password yet — goes through here,
        // so this one check enforces the organization's member options on all
        // of them.
        before: async (account) => {
          if (account.providerId === "google") {
            await assertMemberAuthAllowed(account.userId, "social");
          } else if (account.providerId === "credential") {
            await assertMemberAuthAllowed(account.userId, "password");
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
        // The campaigns and routes an advertiser or publisher gets on accepting.
        // Validated in beforeCreateInvitation, applied in afterAcceptInvitation.
        invitation: {
          additionalFields: {
            campaignIds: { type: "string[]", required: false, input: true, defaultValue: [] },
            routeIds: { type: "string[]", required: false, input: true, defaultValue: [] },
          },
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
      // Grants for the plugin's own endpoints (invitations, member routes). The
      // API's permissions still come from org-roles.js; see org-access-control.js.
      ac,
      roles: PLUGIN_ROLES,
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

        // The plugin only refuses "owner" when the inviter is not one. Ownership
        // carries billing and is never handed out by invitation, whoever asks.
        //
        // An advertiser or publisher sees nothing and sends nothing until access
        // is assigned, so they are only invited together with some. Any other
        // role sees the whole organization and carries no ids.
        beforeCreateInvitation: async ({ invitation }) => {
          const roles = String(invitation.role || "").split(",").map((r) => r.trim());
          if (!roles.length || roles.some((r) => !ASSIGNABLE_ROLES.includes(r))) {
            throw new APIError("BAD_REQUEST", {
              code: "INVALID_INVITATION_ROLE",
              message: `Role must be one of: ${ASSIGNABLE_ROLES.join(", ")}`,
            });
          }

          // The plan caps members besides the owner, and a pending invitation
          // holds a seat (src/lib/member-limit.js). Resends never reach here.
          await assertSeatAvailable(invitation.organizationId, { includePending: true });

          if (!roles.some(isNarrowedRole)) {
            return { data: { ...invitation, campaignIds: [], routeIds: [] } };
          }
          const grants = parseGrants({
            campaignIds: invitation.campaignIds ?? [],
            routeIds: invitation.routeIds ?? [],
          });
          if (!grants || !hasAnyGrant(grants)) {
            throw new APIError("BAD_REQUEST", {
              code: "INVITATION_ACCESS_REQUIRED",
              message: "Assign at least one campaign or route",
            });
          }
          if (!(await grantsBelongToOrg(invitation.organizationId, grants))) {
            throw new APIError("BAD_REQUEST", {
              code: "INVITATION_ACCESS_INVALID",
              message: "Some campaigns or routes do not belong to this organization",
            });
          }
          return { data: { ...invitation, ...grants } };
        },

        // One organization per user is assumed downstream: /api/v1/user reads
        // the first membership, as do the member auth policy and the API-key
        // path. Joining a second would silently pick one of them.
        beforeAcceptInvitation: async ({ user, organization }) => {
          const [owned, membership] = await Promise.all([
            prisma.organization.findUnique({
              where: { ownerId: user.id },
              select: { id: true },
            }),
            prisma.organizationMember.findFirst({
              where: { userId: user.id, NOT: { organizationId: organization.id } },
              select: { id: true },
            }),
          ]);
          if (owned || membership) {
            throw new APIError("BAD_REQUEST", {
              code: "ALREADY_IN_ORGANIZATION",
              message: "You already belong to an organization",
            });
          }

          // This invitation already holds its seat, so only members count. It
          // still fails if the plan was downgraded while the invitation waited.
          await assertSeatAvailable(organization.id, { includePending: false });
        },

        // The plugin writes the member row; the shared helper also fills
        // User.organizationId, which the API-key path reads.
        // The access chosen at invite time is applied here, limited to what
        // still exists: a campaign or route may be deleted while the invitation
        // is pending.
        afterAcceptInvitation: async ({ invitation, member, user, organization }) => {
          try {
            await upsertMembership({
              userId: user.id,
              organizationId: organization.id,
              role: member.role,
            });
            if (isNarrowedRole(member.role)) {
              const grants = await grantsStillInOrg(organization.id, {
                campaignIds: invitation.campaignIds ?? [],
                routeIds: invitation.routeIds ?? [],
              });
              await replaceGrants({ userId: user.id, organizationId: organization.id, ...grants });
            }
          } catch (err) {
            logger.error(
              { err, organizationId: organization.id, userId: user.id },
              "failed to sync membership after accepting invitation",
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

    // /invitation/preview and /invitation/sign-up: the invitation link is proof
    // of the inbox, so an invitee gets a verified account without a second email.
    invitationSignup(),

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
      // Password changes update an existing account row, which the
      // account.create hook never sees, so they are gated by path instead.
      if (ctx.path === "/change-password") {
        const session = await getSessionFromCtx(ctx).catch(() => null);
        if (session?.user?.id) {
          await assertMemberAuthAllowed(session.user.id, "password");
        }
        return;
      }
      if (ctx.path === "/reset-password") {
        const token = ctx.body?.token || ctx.query?.token;
        const verification = token
          ? await ctx.context.internalAdapter
            .findVerificationValue(`reset-password:${token}`)
            .catch(() => null)
          : null;
        if (verification?.value) {
          await assertMemberAuthAllowed(verification.value, "password");
        }
        return;
      }

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
