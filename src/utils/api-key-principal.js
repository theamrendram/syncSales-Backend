import prismaClient from "./prismaClient.js";

const resolveApiKeyPrincipal = async (apiKey, timer) => {
  if (!apiKey || typeof apiKey !== "string") {
    return null;
  }

  const normalizedApiKey = apiKey.trim();
  if (!normalizedApiKey) {
    return null;
  }

  // One round trip: the key owner, their organization's owner and both plans
  // come back joined, so neither the org lookup nor the plan-owner lookup costs
  // a separate query.
  timer?.time("db:user.findUnique(apiKey+org owner)");
  const user = await prismaClient.user.findUnique({
    relationLoadStrategy: "join",
    where: { apiKey: normalizedApiKey },
    select: {
      id: true,
      organizationId: true,
      // Moved off WebmasterProfile. Disables a member's key without deleting them.
      isActive: true,
      userPlan: {
        select: {
          dailyLeadsLimit: true,
        },
      },
      organization: {
        select: {
          ownerId: true,
          owner: {
            select: {
              id: true,
              organizationId: true,
              userPlan: { select: { dailyLeadsLimit: true } },
            },
          },
        },
      },
    },
  });
  timer?.timeEnd("db:user.findUnique(apiKey+org owner)");

  if (!user) {
    return null;
  }

  // Lead quota belongs to the organization, and the organization's plan hangs off
  // its owner. A member who is not the owner therefore bills against the owner's
  // plan — which used to be a rule about webmasters specifically, and is now
  // simply what being a member means.
  const owner = user.organization?.owner ?? null;
  const planUser = owner
    ? {
        id: owner.id,
        organizationId: owner.organizationId || null,
        userPlan: owner.userPlan || null,
      }
    : {
        id: user.id,
        organizationId: user.organizationId || null,
        userPlan: user.userPlan || null,
      };

  return {
    type: "user",
    apiKey: normalizedApiKey,
    actorUserId: user.id,
    planUserId: planUser.id,
    // Always resolved now that the owner's plan rides along; kept so callers
    // that still check it skip their fallback lookup.
    planUserResolved: true,
    planUser,
    organizationId: user.organizationId || null,
    isActive: user.isActive,
  };
};

export { resolveApiKeyPrincipal };
