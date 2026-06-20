const prisma = require("./prismaClient");

/**
 * Campaign IDs linked to a webmaster for an org (many-to-many via CampaignWebmaster).
 */
async function getCampaignIdsForWebmaster(userId, organizationId) {
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
async function getExplicitRouteIdsForWebmaster(userId, organizationId) {
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

/** Route IDs used by campaigns + explicit route grants. */
async function getRouteIdsForWebmaster(userId, organizationId) {
  const campaignIds = await getCampaignIdsForWebmaster(userId, organizationId);
  const explicitRouteIds = await getExplicitRouteIdsForWebmaster(
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

/**
 * Lead scope for webmaster. A webmaster can view leads by campaign OR by explicit route.
 */
async function getLeadScopeForWebmaster(userId, organizationId) {
  const [campaignIds, routeIds] = await Promise.all([
    getCampaignIdsForWebmaster(userId, organizationId),
    getRouteIdsForWebmaster(userId, organizationId),
  ]);
  return { campaignIds, routeIds };
}

module.exports = {
  getCampaignIdsForWebmaster,
  getRouteIdsForWebmaster,
  getExplicitRouteIdsForWebmaster,
  getLeadScopeForWebmaster,
};
