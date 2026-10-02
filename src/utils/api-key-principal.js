import prismaClient from "./prismaClient.js";

const resolveApiKeyPrincipal = async (apiKey, timer) => {
  if (!apiKey || typeof apiKey !== "string") {
    return null;
  }

  const normalizedApiKey = apiKey.trim();
  if (!normalizedApiKey) {
    return null;
  }

  timer?.time("db:user.findUnique(apiKey)");
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
    },
  });
  timer?.timeEnd("db:user.findUnique(apiKey)");

  if (!user) {
    return null;
  }

  // The plan owner is usually the key owner, so its plan rides along with this
  // query. When it is not — a member posting against their organization's plan —
  // planUserResolved is false and the caller fetches the plan owner itself.
  const selfPlanUser = {
    id: user.id,
    organizationId: user.organizationId || null,
    userPlan: user.userPlan || null,
  };

  // Lead quota belongs to the organization, and the organization's plan hangs off
  // its owner. A member who is not the owner therefore bills against the owner's
  // plan — which used to be a rule about webmasters specifically, and is now
  // simply what being a member means.
  let planUserId = user.id;
  if (user.organizationId) {
    timer?.time("db:organization.findUnique(owner)");
    const org = await prismaClient.organization.findUnique({
      where: { id: user.organizationId },
      select: { ownerId: true },
    });
    timer?.timeEnd("db:organization.findUnique(owner)");
    if (org?.ownerId) {
      planUserId = org.ownerId;
    }
  }

  return {
    type: "user",
    apiKey: normalizedApiKey,
    actorUserId: user.id,
    planUserId,
    planUserResolved: planUserId === user.id,
    planUser: planUserId === user.id ? selfPlanUser : null,
    organizationId: user.organizationId || null,
    isActive: user.isActive,
  };
};

export { resolveApiKeyPrincipal };
