/**
 * Signing up from an organization invitation link.
 *
 * The invitation email links to `${APP_URL}/accept-invitation/<id>`. Someone
 * opening it may have no account yet, and the core /sign-up/email route cannot
 * serve them: with requireEmailVerification on, it forces emailVerified false,
 * mails a verification link and returns no session. The invitee would verify,
 * land on onboarding and be asked to create an organization of their own.
 *
 * Skipping verification here is safe because the invitation id is the proof.
 * It is a random uuid that was only ever sent to the invited address, so
 * whoever holds it has read that inbox — the same thing a verification link
 * proves. The email is therefore taken from the invitation row, never from the
 * request: the endpoint can only ever create the account the link was sent to.
 *
 * Accepting stays a separate, explicit step through the organization plugin,
 * so beforeAcceptInvitation and afterAcceptInvitation still run.
 */
import { z } from "zod";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";

import prisma from "../utils/core/prismaClient.js";
import logger from "../utils/core/logger.js";

/**
 * The invitation, if it can still be accepted. Throws a 404 APIError otherwise,
 * with a code per reason so the page can say which.
 */
export async function findPendingInvitation(id) {
  const invitation = await prisma.invitation.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      expiresAt: true,
      organizationId: true,
      organization: { select: { name: true } },
      inviter: { select: { name: true } },
    },
  });
  if (!invitation) {
    throw new APIError("NOT_FOUND", {
      code: "INVITATION_NOT_FOUND",
      message: "This invitation could not be found.",
    });
  }
  if (invitation.status !== "pending") {
    throw new APIError("NOT_FOUND", {
      code: "INVITATION_NOT_PENDING",
      message: `This invitation has already been ${invitation.status}.`,
    });
  }
  if (new Date(invitation.expiresAt) < new Date()) {
    throw new APIError("NOT_FOUND", {
      code: "INVITATION_EXPIRED",
      message: "This invitation has expired. Ask for a new one.",
    });
  }
  return invitation;
}

/** GET /invitation/preview — what the invitation page shows before sign-in. */
export async function previewInvitation(ctx) {
  const invitation = await findPendingInvitation(ctx.query.id);
  const email = invitation.email.toLowerCase();
  const existing = await ctx.context.internalAdapter.findUserByEmail(email);
  return ctx.json({
    id: invitation.id,
    email,
    role: invitation.role,
    organizationId: invitation.organizationId,
    organizationName: invitation.organization?.name ?? null,
    inviterName: invitation.inviter?.name ?? null,
    expiresAt: invitation.expiresAt,
    hasAccount: Boolean(existing?.user),
  });
}

/** POST /invitation/sign-up — creates a verified account and signs it in. */
export async function signUpFromInvitation(ctx) {
  const { invitationId, name, password } = ctx.body;
  const invitation = await findPendingInvitation(invitationId);
  const email = invitation.email.toLowerCase();

  const { minPasswordLength, maxPasswordLength } = ctx.context.password.config;
  if (password.length < minPasswordLength || password.length > maxPasswordLength) {
    throw new APIError("BAD_REQUEST", {
      code: "INVALID_PASSWORD_LENGTH",
      message: `Password must be between ${minPasswordLength} and ${maxPasswordLength} characters`,
    });
  }

  const { internalAdapter } = ctx.context;
  if (await internalAdapter.findUserByEmail(email)) {
    throw new APIError("CONFLICT", {
      code: "USER_ALREADY_EXISTS",
      message: "An account already exists for this email. Sign in instead.",
    });
  }

  // Hashed before the user exists, as the core route does, so a failure here
  // cannot leave a user row with no way to sign in.
  const hash = await ctx.context.password.hash(password);

  // Both writes go through the configured databaseHooks: the user hook splits
  // the name, the account hook checks the member auth policy (which allows a
  // user with no membership yet).
  const user = await internalAdapter.createUser(
    { email, name, emailVerified: true },
    { method: "email-password" },
  );
  if (!user) {
    throw new APIError("UNPROCESSABLE_ENTITY", {
      code: "FAILED_TO_CREATE_USER",
      message: "Failed to create the account",
    });
  }
  await internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: hash,
  });

  const session = await internalAdapter.createSession(user.id);
  if (!session) {
    throw new APIError("BAD_REQUEST", {
      code: "FAILED_TO_CREATE_SESSION",
      message: "Account created, but signing in failed. Sign in to continue.",
    });
  }
  await setSessionCookie(ctx, { session, user });

  logger.info({ evt: "invitation_signup", userId: user.id, invitationId }, "account created from invitation");

  return ctx.json({
    user: { id: user.id, email: user.email, name: user.name, emailVerified: user.emailVerified },
  });
}

export const invitationSignup = () => ({
  id: "invitation-signup",
  endpoints: {
    previewInvitation: createAuthEndpoint(
      "/invitation/preview",
      {
        method: "GET",
        query: z.object({ id: z.string().min(1) }),
      },
      previewInvitation,
    ),
    signUpFromInvitation: createAuthEndpoint(
      "/invitation/sign-up",
      {
        method: "POST",
        body: z.object({
          invitationId: z.string().min(1),
          name: z.string().trim().min(1).max(100),
          password: z.string(),
        }),
      },
      signUpFromInvitation,
    ),
  },
  // Both endpoints answer without a session; keep them from being used to
  // probe invitation ids or which addresses have accounts.
  rateLimit: [
    {
      pathMatcher: (path) => path.startsWith("/invitation/"),
      window: 60,
      max: 10,
    },
  ],
});
