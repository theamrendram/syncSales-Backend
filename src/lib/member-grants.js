/**
 * Writing what an advertiser or publisher may see.
 *
 * Campaign grants are CampaignWebmaster rows and route grants are AccessControl
 * rows — the two tables src/utils/resource-grants.js reads, so a grant written
 * here narrows every scoped endpoint without further wiring.
 *
 * Shared by the member access editor, role changes and invitations: a narrowed
 * role with nothing assigned sees nothing and can send nothing, so every path
 * that hands one out must assign something in the same step.
 */
import { z } from "zod";
import prisma from "../utils/prismaClient.js";

export const MAX_GRANTS = 500;

const grantsSchema = z
  .object({
    campaignIds: z.array(z.string().uuid()).max(MAX_GRANTS),
    routeIds: z.array(z.string().uuid()).max(MAX_GRANTS),
  })
  .strict();

/** `{ campaignIds, routeIds }` deduped, or null when the shape is wrong. */
export function parseGrants(value) {
  const parsed = grantsSchema.safeParse(value ?? {});
  if (!parsed.success) return null;
  return {
    campaignIds: [...new Set(parsed.data.campaignIds)],
    routeIds: [...new Set(parsed.data.routeIds)],
  };
}

export function hasAnyGrant(grants) {
  return Boolean(grants && (grants.campaignIds.length || grants.routeIds.length));
}

/**
 * True when every id belongs to this organization. Ids are client-supplied, so
 * without this a grant could reach into another organization's campaign.
 */
export async function grantsBelongToOrg(organizationId, grants, client = prisma) {
  const [campaignCount, routeCount] = await Promise.all([
    client.campaign.count({ where: { id: { in: grants.campaignIds }, organizationId } }),
    client.route.count({
      where: { id: { in: grants.routeIds }, organizationId, deletedAt: null },
    }),
  ]);
  return campaignCount === grants.campaignIds.length && routeCount === grants.routeIds.length;
}

/** The subset of `grants` that still exists in this organization. */
export async function grantsStillInOrg(organizationId, grants, client = prisma) {
  const [campaigns, routes] = await Promise.all([
    client.campaign.findMany({
      where: { id: { in: grants.campaignIds }, organizationId },
      select: { id: true },
    }),
    client.route.findMany({
      where: { id: { in: grants.routeIds }, organizationId, deletedAt: null },
      select: { id: true },
    }),
  ]);
  return { campaignIds: campaigns.map((c) => c.id), routeIds: routes.map((r) => r.id) };
}

/** The member's current grants in this organization. */
export async function getMemberGrants(userId, organizationId, client = prisma) {
  const [campaigns, routes] = await Promise.all([
    client.campaignWebmaster.findMany({
      where: { userId, campaign: { organizationId } },
      select: { campaignId: true },
      take: MAX_GRANTS,
    }),
    client.accessControl.findMany({
      where: { userId, organizationId, routeId: { not: null } },
      select: { routeId: true },
      take: MAX_GRANTS,
    }),
  ]);
  return {
    campaignIds: campaigns.map((c) => c.campaignId),
    routeIds: routes.map((r) => r.routeId),
  };
}

/**
 * Interactive-transaction limits for callers that write grants together with
 * other rows. Prisma's 5s default is shorter than a few round trips to a remote
 * database, and an expired transaction fails the whole write.
 */
export const GRANT_TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 };

/** The four writes that replace a member's grants, unawaited. */
function replaceGrantsOps(client, { userId, organizationId, campaignIds, routeIds }) {
  return [
    client.campaignWebmaster.deleteMany({ where: { userId, campaign: { organizationId } } }),
    client.accessControl.deleteMany({
      where: { userId, organizationId, routeId: { not: null } },
    }),
    client.campaignWebmaster.createMany({
      data: campaignIds.map((campaignId) => ({ campaignId, userId })),
    }),
    client.accessControl.createMany({
      data: routeIds.map((routeId) => ({
        userId,
        organizationId,
        routeId,
        accessType: "view",
      })),
    }),
  ];
}

/**
 * Replaces the member's campaign and route grants with exactly these.
 *
 * Pass `client` (an interactive transaction) to make it atomic with the
 * caller's other writes. Without one, the writes go as a single batch
 * transaction, which has no interactive timeout to run out.
 */
export async function replaceGrants({ client, ...grants }) {
  if (!client) {
    await prisma.$transaction(replaceGrantsOps(prisma, grants));
    return;
  }
  // Prisma queries run when awaited, so awaiting in turn keeps deletes before
  // creates inside the caller's transaction.
  for (const op of replaceGrantsOps(client, grants)) {
    await op;
  }
}
