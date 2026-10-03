/**
 * Who may change how they sign in.
 *
 * An organization's owner always may. Every other member may set or reset a
 * password, or link a Google account, only when the owner has switched that on
 * for the organization (Organization.allowMemberPasswordManagement /
 * allowMemberSocialLinking, both off by default).
 *
 * A user with no membership at all is allowed. That is a fresh signup or someone
 * part-way through accepting an invitation, and refusing them would break both
 * flows — the account rows they create are what makes them a user at all.
 */
import { APIError } from "better-auth/api";

import prisma from "../utils/prismaClient.js";

const orgPolicySelect = {
  id: true,
  ownerId: true,
  allowMemberPasswordManagement: true,
  allowMemberSocialLinking: true,
};

const ALLOW_ALL = {
  isOwner: false,
  organizationId: null,
  canManagePassword: true,
  canLinkGoogle: true,
  orgSettings: null,
};

function settingsOf(org) {
  return {
    allowMemberPasswordManagement: org.allowMemberPasswordManagement,
    allowMemberSocialLinking: org.allowMemberSocialLinking,
  };
}

export async function getMemberAuthPolicy(userId) {
  if (!userId) return { ...ALLOW_ALL };

  const owned = await prisma.organization.findUnique({
    where: { ownerId: userId },
    select: orgPolicySelect,
  });
  if (owned) {
    return {
      isOwner: true,
      organizationId: owned.id,
      canManagePassword: true,
      canLinkGoogle: true,
      orgSettings: settingsOf(owned),
    };
  }

  const membership = await prisma.organizationMember.findFirst({
    where: { userId },
    orderBy: { joinedAt: "asc" },
    select: { organization: { select: orgPolicySelect } },
  });
  const org = membership?.organization;
  if (!org) return { ...ALLOW_ALL };

  return {
    isOwner: false,
    organizationId: org.id,
    canManagePassword: org.allowMemberPasswordManagement,
    canLinkGoogle: org.allowMemberSocialLinking,
    orgSettings: settingsOf(org),
  };
}

/** Throws a 403 APIError unless `userId` may perform `kind` ("password" | "social"). */
export async function assertMemberAuthAllowed(userId, kind) {
  const policy = await getMemberAuthPolicy(userId);
  const allowed = kind === "social" ? policy.canLinkGoogle : policy.canManagePassword;
  if (!allowed) {
    throw new APIError("FORBIDDEN", {
      code: "MEMBER_AUTH_DISABLED",
      message:
        kind === "social"
          ? "Your organization owner has not enabled linking Google accounts"
          : "Your organization owner has not enabled password management",
    });
  }
}
