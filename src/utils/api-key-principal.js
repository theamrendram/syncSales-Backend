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
    },
  });

  console.log("[resolveApiKeyPrincipal] user", user);
  if (user) {
    const linkedWebmaster = await prismaClient.webmaster.findUnique({
      where: { apiKey: normalizedApiKey },
      select: {
        id: true,
        userId: true,
        organizationId: true,
        isActive: true,
      },
    });

    console.log("[resolveApiKeyPrincipal] linkedWebmaster", linkedWebmaster);
    if (linkedWebmaster) {
      return {
        type: "webmaster",
        apiKey: normalizedApiKey,
        webmasterId: linkedWebmaster.id,
        actorUserId: user.id,
        planUserId: linkedWebmaster.userId,
        organizationId:
          linkedWebmaster.organizationId || user.organizationId || null,
        isActive: linkedWebmaster.isActive,
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
  }

  const webmaster = await prismaClient.webmaster.findUnique({
    where: { apiKey: normalizedApiKey },
    select: {
      id: true,
      userId: true,
      apiKey: true,
      organizationId: true,
      isActive: true,
    },
  });

  console.log("[resolveApiKeyPrincipal] webmaster", webmaster);
  if (!webmaster) {
    return null;
  }

  return {
    type: "webmaster",
    apiKey: normalizedApiKey,
    webmasterId: webmaster.id,
    actorUserId: webmaster.apiKey,
    planUserId: webmaster.userId,
    organizationId: webmaster.organizationId || null,
    isActive: webmaster.isActive,
  };
};

module.exports = {
  resolveApiKeyPrincipal,
};
