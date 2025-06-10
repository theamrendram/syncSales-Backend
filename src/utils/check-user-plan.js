const prismaClient = require("./prismaClient");
const rateLimiter = require("express-rate-limit");

let limit = 0;
const checkUserPlan = async (req, res, next) => {
  try {
    const { apiKey } = req.body;
    console.log("Api Key:", apiKey);
    if (!apiKey) {
      return res.status(400).json({ error: "API key is required" });
    }
    const user = await prismaClient.user.findUnique({
      where: {
        apiKey: apiKey,
      },
      include: {
        userPlan: true,
      },
    });

    if (!user) {
      return res.status(401).json({ error: "Invalid API key" });
    }

    if (!user.userPlan) {
      return res.status(403).json({ error: "User plan not found" });
    }
    const { dailyLeadsLimit } = user.userPlan;
    console.log("User Plan Daily Limit:", dailyLeadsLimit);
    limit = dailyLeadsLimit;

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0); // normalized to utc midnight
    // get or create
    const usage = await prismaClient.leadUsage.upsert({
      where: {
        userId_date: {
          userId: user.id,
          date: today,
        },
      },
      update: {}, // no need to update yet
      create: {
        userId: user.id,
        date: today,
      },
    });

    if (usage >= dailyLeadsLimit) {
      return req.status(429).json({
        error: "Daily lead limit reached",
      });
    }

    next();
  } catch (error) {
    console.error("Error checking user plan:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

module.exports = {
  checkUserPlan,
};
