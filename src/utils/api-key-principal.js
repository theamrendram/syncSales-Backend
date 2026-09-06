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
      webmasterProfile: {
        select: {
          isActive: true,
        },
      },
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
  // query. When it is not (webmaster under an org owner), planUserResolved is
  // false and the caller must fetch the plan owner itself.
  const selfPlanUser = {
    id: user.id,
    organizationId: user.organizationId || null,
    userPlan: user.userPlan || null,
  };

  if (user.webmasterProfile) {
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
      type: "webmaster",
      apiKey: normalizedApiKey,
      actorUserId: user.id,
      planUserId,
      planUserResolved: planUserId === user.id,
      planUser: planUserId === user.id ? selfPlanUser : null,
      organizationId: user.organizationId || null,
      isActive: user.webmasterProfile.isActive,
    };
  }

  return {
    type: "user",
    apiKey: normalizedApiKey,
    actorUserId: user.id,
    planUserId: user.id,
    planUserResolved: true,
    planUser: selfPlanUser,
    organizationId: user.organizationId || null,
    isActive: true,
  };
};

export { resolveApiKeyPrincipal };
