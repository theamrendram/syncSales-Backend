/**
 * How many people an organization may have besides its owner.
 *
 * Starter allows 2, Professional 10, Enterprise has no cap. An organization
 * with no plan row gets the Starter limit rather than none, so a missing or
 * not-yet-created plan never means unlimited.
 *
 * Pending invitations reserve a seat. Checking only on accept would let an
 * admin send any number of invitations and leave whoever clicks last facing
 * "organization is full" after already creating an account. Cancelling an
 * invitation, or letting it expire, frees its seat.
 *
 * The owner is not counted: they hold billing and are never a seat.
 *
 * UserPlan.maxWebmasters is not consulted. Its values in production (2 and 5
 * for two Pro rows) predate this rule and disagree with it.
 */
import { APIError } from "better-auth/api";

import prisma from "../utils/core/prismaClient.js";

export const PLAN_MEMBER_LIMITS = {
  starter: 2,
  professional: 10,
  enterprise: Infinity,
};

const TIER_LABELS = {
  starter: "Starter",
  professional: "Professional",
  enterprise: "Enterprise",
};

/**
 * Maps a UserPlan.name to a tier. Rows in production are named "Basic Plan"
 * and "Pro Plan"; the pricing page calls the same plans Starter and
 * Professional, with checkout ids "basic" and "pro". Anything unrecognised,
 * including no plan, is Starter.
 */
export function planTier(planName) {
  const name = String(planName || "").toLowerCase();
  if (name.includes("enterprise")) return "enterprise";
  if (/\bpro\b|professional/.test(name)) return "professional";
  return "starter";
}

/**
 * The plan that governs an organization: the owner's own UserPlan, else the
 * newest one attached to the organization — the same precedence
 * check-user-plan.js uses for lead limits.
 */
async function findOrgPlanName(organizationId) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { ownerId: true, owner: { select: { userPlan: { select: { name: true } } } } },
  });
  if (org?.owner?.userPlan) return { ownerId: org.ownerId, planName: org.owner.userPlan.name };

  const orgPlan = await prisma.userPlan.findFirst({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    select: { name: true },
  });
  return { ownerId: org?.ownerId ?? null, planName: orgPlan?.name ?? null };
}

/** Seats in use: members other than the owner, plus live pending invitations. */
async function countUsedSeats(organizationId, ownerId, { includePending }) {
  const [members, pending] = await Promise.all([
    prisma.organizationMember.count({
      where: {
        organizationId,
        NOT: [{ role: "owner" }, ...(ownerId ? [{ userId: ownerId }] : [])],
      },
    }),
    includePending
      ? prisma.invitation.count({
          where: { organizationId, status: "pending", expiresAt: { gt: new Date() } },
        })
      : 0,
  ]);
  return { members, pending };
}

/** `{ tier, limit, members, pending }` for an organization. */
export async function getMemberUsage(organizationId, { includePending = true } = {}) {
  const { ownerId, planName } = await findOrgPlanName(organizationId);
  const tier = planTier(planName);
  const limit = PLAN_MEMBER_LIMITS[tier];
  const { members, pending } = await countUsedSeats(organizationId, ownerId, { includePending });
  return { tier, limit, members, pending };
}

/**
 * Throws a 403 APIError (code MEMBER_LIMIT_REACHED) when adding one more
 * person would exceed the plan.
 *
 * `includePending` is true when a new seat is being claimed (sending an
 * invitation, adding a member directly) and false when an invitation is being
 * accepted — that invitation already holds its seat.
 */
export async function assertSeatAvailable(organizationId, { includePending }) {
  const { tier, limit, members, pending } = await getMemberUsage(organizationId, { includePending });
  if (members + pending < limit) return;

  // An acceptance is refused to the invitee, who can do nothing about it but
  // tell whoever invited them; everything else is refused to an admin.
  throw new APIError("FORBIDDEN", {
    code: "MEMBER_LIMIT_REACHED",
    message: includePending
      ? `The ${TIER_LABELS[tier]} plan allows ${limit} members besides the owner` +
        (pending ? `, and pending invitations count toward that` : "") +
        ". Remove a member or cancel an invitation, or upgrade your plan."
      : "This organization has no free seats on its plan. Ask the person who invited you to free one or upgrade.",
  });
}
