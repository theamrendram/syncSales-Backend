/**
 * Better Auth instance — the single source of identity for the whole product.
 *
 * Both Next apps are consumers: they forward the session cookie to this API
 * and never hold a credential of their own. Nothing else in the codebase
 * should construct sessions or verify passwords.
 */
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { organization } from "better-auth/plugins";

import prisma from "../utils/prismaClient.js";
import logger from "../utils/logger.js";
import { sendEmail } from "./email/index.js";
import {
  verifyEmailTemplate,
  resetPasswordTemplate,
  organizationInviteTemplate,
} from "./email/templates.js";
import { ORG_ROLES, DEFAULT_ROLE } from "./org-roles.js";

const APP_URL = process.env.APP_URL || "http://localhost:3000";
const CRM_URL = process.env.CRM_URL || "http://localhost:3001";
const BASE_URL = process.env.BETTER_AUTH_URL || "http://localhost:8000";

/**
 * Cookies are shared across syncsales.in and its subdomains so one sign-in on
 * the marketing site also authenticates the CRM. Left unset in development,
 * where the apps are localhost ports and a domain attribute would break them.
 */
const COOKIE_DOMAIN = process.env.AUTH_COOKIE_DOMAIN || null;

export const auth = betterAuth({
  appName: "SyncSales",
  baseURL: BASE_URL,
  secret: process.env.BETTER_AUTH_SECRET,

  database: prismaAdapter(prisma, { provider: "postgresql" }),

  // The existing User table is adopted rather than replaced, which is what
  // keeps every foreign key in the schema pointing at rows that still exist.
  // Legacy ids stay Clerk-shaped; new ones are generated. Nothing reads the
  // format, so the two coexist.
  // No modelName overrides anywhere below. The Prisma adapter addresses models
  // by their client property — it lower-cases the first letter, so `User`
  // becomes `user` — and compares that against Better Auth's model names, which
  // are already lower-case. Our PascalCase Prisma models therefore line up with
  // the defaults exactly. Setting modelName: "User" makes the comparison fail
  // and every table reads as missing.
  user: {
    // Better Auth strips anything it does not recognise from an insert, so the
    // columns the databaseHook below fills have to be declared here or they
    // silently land as their column defaults. `input: false` keeps them out of
    // the public sign-up payload — they are derived from `name`, never sent.
    additionalFields: {
      firstName: { type: "string", required: false, input: false },
      lastName: { type: "string", required: false, input: false },
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
        url,
      });
      await sendEmail({ to: user.email, subject, html });
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      const { subject, html } = verifyEmailTemplate({ name: user.name, url });
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
    user: {
      create: {
        // Better Auth only knows `name`, but the rest of the codebase reads
        // firstName/lastName everywhere (lead attribution, webmaster listings,
        // CSV exports). Split once, here, so no downstream code has to care
        // which system created the row.
        before: async (user) => {
          if (user.firstName || user.lastName) return;
          const parts = String(user.name || "").trim().split(/\s+/).filter(Boolean);
          return {
            data: {
              ...user,
              firstName: parts[0] || "",
              lastName: parts.slice(1).join(" ") || "",
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
        beforeCreateOrganization: async ({ organization, user }) => ({
          data: { ...organization, ownerId: user.id },
        }),
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
  ],

  onAPIError: {
    onError: (error) => {
      logger.error({ err: error }, "better-auth error");
    },
  },
});

export default auth;
