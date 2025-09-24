const prismaClient = require("./prismaClient");

const checkUserPlan = async (req, res, next) => {
  try {
    const { apiKey } = req.body;

    if (!apiKey) {
      return res.status(400).json({ error: "API key is required" });
    }
    const user = await prismaClient.user.findUnique({
      where: { apiKey },
      include: { userPlan: true },
    });

    if (!user) {
      return res.status(401).json({ error: "Invalid API key" });
    }

    if (!user.userPlan) {
      return res.status(403).json({ error: "User plan not found" });
    }

    const { dailyLeadsLimit } = user.userPlan;



    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // Ensure usage row exists
    const usage = await prismaClient.leadUsage.upsert({
      where: {
        userId_date: {
          userId: user.id,
          date: today,
        },
      },
      update: {},
      create: {
        userId: user.id,
        date: today,
        count: 0,
        organizationId: user.organizationId,
      },
    });
    console.log("dailyLeadsLimit", dailyLeadsLimit);
    if (dailyLeadsLimit === 0) {
      next();
      return;
    }

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
