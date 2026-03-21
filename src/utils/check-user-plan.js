const prismaClient = require("./prismaClient");
const { resolveApiKeyPrincipal } = require("./api-key-principal");

const checkUserPlan = async (req, res, next) => {
  try {
    const { apiKey } = req.body;

    if (!apiKey) {
      return res.status(400).json({ error: "API key is required" });
    }
    const principal = await resolveApiKeyPrincipal(apiKey);
    if (!principal) {
      return res.status(401).json({ error: "Invalid API key" });
    }

    if (!principal.organizationId) {
      return res.status(400).json({
        error: "API key must belong to an organization",
      });
    }

    if (principal.type === "webmaster" && !principal.isActive) {
      return res.status(403).json({ error: "Webmaster is inactive" });
    }

    const user = await prismaClient.user.findUnique({
      where: { id: principal.planUserId },
      select: {
        id: true,
        organizationId: true,
        userPlan: {
          select: {
            dailyLeadsLimit: true,
          },
        },
      },
    });

    const orgUserPlan = !user?.userPlan
      ? await prismaClient.userPlan.findFirst({
          where: { organizationId: principal.organizationId },
          orderBy: { createdAt: "desc" },
          select: { dailyLeadsLimit: true },
        })
      : null;

    const effectivePlan = user?.userPlan || orgUserPlan;
    if (!effectivePlan) {
      return res.status(403).json({ error: "User plan not found" });
    }

    const usageUserId =
      user?.id || principal.planUserId || principal.actorUserId || null;
    if (!usageUserId) {
      return res.status(401).json({ error: "Invalid API key owner" });
    }

    const { dailyLeadsLimit } = effectivePlan;



    if (dailyLeadsLimit === 0) {
      next();
      return;
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // Ensure usage row exists only when there is an enforced limit.
    const usage = await prismaClient.leadUsage.upsert({
      where: {
        userId_date: {
          userId: usageUserId,
          date: today,
        },
      },
      update: {},
      create: {
        userId: usageUserId,
        date: today,
        count: 0,
        organizationId: principal.organizationId || user?.organizationId,
      },
    });

    if (usage.count >= dailyLeadsLimit) {
      return res.status(429).json({ error: "Daily lead limit reached" });
    }

    next();
  } catch (error) {
    console.error("Error checking user plan:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

module.exports = { checkUserPlan };
