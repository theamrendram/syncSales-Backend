const prismaClient = require("./prismaClient");

const resolveApiKeyPrincipal = async (apiKey) => {
  if (!apiKey || typeof apiKey !== "string") {
    return null;
  }

  const normalizedApiKey = apiKey.trim();
  if (!normalizedApiKey) {
    return null;
  }

  const user = await prismaClient.user.findUnique({
    where: { apiKey: normalizedApiKey },
    select: {
      id: true,
      organizationId: true,
      webmasterProfile: {
        select: {
          isActive: true,
        },
      },
    },
  });

  console.log("[resolveApiKeyPrincipal] user", user);
  if (!user) {
    return null;
  }

  if (user.webmasterProfile) {
    let planUserId = user.id;
    if (user.organizationId) {
      const org = await prismaClient.organization.findUnique({
        where: { id: user.organizationId },
        select: { ownerId: true },
      });
      if (org?.ownerId) {
        planUserId = org.ownerId;
      }
    }

    return {
      type: "webmaster",
      apiKey: normalizedApiKey,
      actorUserId: user.id,
      planUserId,
      organizationId: user.organizationId || null,
      isActive: user.webmasterProfile.isActive,
    };
  }

  return {
    type: "user",
    apiKey: normalizedApiKey,
    actorUserId: user.id,
    planUserId: user.id,
    organizationId: user.organizationId || null,
    isActive: true,
  };
};

module.exports = {
  resolveApiKeyPrincipal,
};
