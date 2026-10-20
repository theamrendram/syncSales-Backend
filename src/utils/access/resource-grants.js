import prisma from "../core/prismaClient.js";

/**
 * Explicit resource grants, and what they narrow a member to.
 *
 * A member with no grants sees their whole organization. A member with any grant
 * sees only what was granted — which is the entire "webmaster" idea, minus the
 * separate account type it used to require. CampaignWebmaster keeps its table
 * name; what it means now is "this member may see this campaign", for any role.
 *
 * `hasResourceGrants` is asked once per request, not per resource: a member
 * granted one campaign is a narrowed member for routes and leads too, even where
 * the derived list for those comes out empty. Deciding it per resource would let
 * a member with a campaign grant but no route grant fall back to seeing every
 * route in the organization.
 */
async function getGrantedCampaignIds(userId, organizationId) {
  if (!userId || !organizationId) {
    return [];
  }
  const rows = await prisma.campaignWebmaster.findMany({
    where: {
      userId,
      campaign: { organizationId },
    },
    select: { campaignId: true },
  });
  return [...new Set(rows.map((r) => r.campaignId))];
}

/**
 * Route IDs explicitly granted to webmaster (AccessControl.routeId).
 */
async function getExplicitRouteIds(userId, organizationId) {
  if (!userId || !organizationId) {
    return [];
  }
  const rows = await prisma.accessControl.findMany({
    where: {
      userId,
      organizationId,
      routeId: { not: null },
      accessType: "view",
    },
    select: { routeId: true },
  });
  return [...new Set(rows.map((r) => r.routeId).filter(Boolean))];
}

/** Routes reachable through granted campaigns, plus routes granted directly. */
async function getGrantedRouteIds(userId, organizationId) {
  const campaignIds = await getGrantedCampaignIds(userId, organizationId);
  const explicitRouteIds = await getExplicitRouteIds(
    userId,
    organizationId,
  );
  if (!campaignIds.length) {
    return explicitRouteIds;
  }
  const rows = await prisma.campaign.findMany({
    where: { id: { in: campaignIds } },
    select: { routeId: true },
  });
  return [...new Set([...rows.map((r) => r.routeId), ...explicitRouteIds])];
}

/** Leads are reachable by granted campaign OR by granted route, so this is a union. */
async function getGrantedLeadScope(userId, organizationId) {
  const [campaignIds, routeIds] = await Promise.all([
    getGrantedCampaignIds(userId, organizationId),
    getGrantedRouteIds(userId, organizationId),
  ]);
  return { campaignIds, routeIds };
}

/**
 * Whether this member's view is narrowed at all.
 *
 * One query per table rather than loading the ids: the answer is only ever used
 * as a boolean, and a member with thousands of grants should not pay for the list
 * to find out they have some.
 */
async function hasResourceGrants(userId, organizationId) {
  const [campaigns, routes] = await Promise.all([
    prisma.campaignWebmaster.count({
      where: { userId, campaign: { organizationId } },
    }),
    prisma.accessControl.count({ where: { userId, organizationId } }),
  ]);
  return campaigns > 0 || routes > 0;
}

export {
  getGrantedCampaignIds,
  getGrantedRouteIds,
  getExplicitRouteIds,
  getGrantedLeadScope,
  hasResourceGrants,
};
