const prismaClient = require("../utils/prismaClient");
const {
  chartMetrics,
  generateExtendedReport,
  getLeadsGroupedByDateRouteCampaign,
} = require("../utils/chart-functions");

const getChartData = async (req, res) => {
  try {
    const { userId } = req.auth;
    if (!userId) {
      return res.status(400).json({ error: "User ID not found" });
    }

    const user = await prismaClient.user.findUnique({
      where: { id: userId },
      select: { role: true, companyId: true, email: true },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Setup the where clause based on user role
    let where = {};

    if (user.role === "admin") {
      if (!user.companyId) {
        return res
          .status(400)
          .json({ error: "Company ID not found for admin" });
      }
      where = { user: { companyId: user.companyId } };
    } else if (user.role === "webmaster") {
      const webmaster = await prismaClient.webmaster.findUnique({
        where: { email: user.email },
        select: { campaigns: { select: { id: true } } },
      });

      if (!webmaster) {
        return res.status(404).json({ error: "Webmaster not found" });
      }

      const campaignIds = webmaster.campaigns.map((c) => c.id);
      if (!campaignIds.length) {
        return res.json({
          newChartData: [],
          totalLeads: 0,
          metricData: {
            todaysLeads: 0,
            yesterdaysLeads: 0,
            lastMonthLeads: 0,
            todaysExpectedRevenue: 0,
          },
        });
      }

      where = { campaignId: { in: campaignIds } };
    } else {
      return res.status(403).json({ error: "Unauthorized role" });
    }

    const leads = await prismaClient.lead.findMany({
      where,
      include: {
        campaign: { select: { name: true, campId: true } },
        route: { select: { payout: true, name: true, routeId: true } },
      },
    });
    const extendedReport = generateExtendedReport(leads);
    const responseData = {
      newChartData: await getLeadsGroupedByDateRouteCampaign(leads),
      totalLeads: leads.length,
      metricData: chartMetrics(leads),
      extendedReport,
    };

    res.json(responseData);
  } catch (error) {
    console.error("Error getting chart data:", error);
    res.status(500).json({
      error: "Unable to get chart data",
      details: error.message,
    });
  }
};

const getMetricData = async (req, res) => {
  console.log("get metric data");
  try {
    const { userId } = req.auth;
    if (!userId) {
      return res.status(400).json({ error: "User ID not found" });
    }

    const user = await prismaClient.user.findUnique({
      where: { id: userId },
      select: { role: true, companyId: true, email: true },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Setup the where clause based on user role
    let where = {};

    if (user.role === "admin") {
      if (!user.companyId) {
        return res
          .status(400)
          .json({ error: "Company ID not found for admin" });
      }
      where = { user: { companyId: user.companyId } };
    } else if (user.role === "webmaster") {
      const webmaster = await prismaClient.webmaster.findUnique({
        where: { email: user.email },
        select: { campaigns: { select: { id: true } } },
      });

      if (!webmaster) {
        return res.status(404).json({ error: "Webmaster not found" });
      }

      const campaignIds = webmaster.campaigns.map((c) => c.id);
      if (!campaignIds.length) {
        return res.json({
          todaysLeads: 0,
          yesterdaysLeads: 0,
          todaysExpectedRevenue: 0,
          conversionRate: 0,
          totalRevenue: 0,
          lastMonthLeads: 0,
          averageRevenuePerLead: 0,
          totalLeads: 0,
        });
      }

      where = { campaignId: { in: campaignIds } };
    } else {
      return res.status(403).json({ error: "Unauthorized role" });
    }

    const leads = await prismaClient.lead.findMany({
      where,
      include: {
        campaign: { select: { name: true, campId: true } },
        route: { select: { payout: true, name: true, routeId: true } },
      },
    });
    const metricData = await chartMetrics(leads);
    console.log("metric data", metricData);
    res.status(200).json({ metricData: metricData });
  } catch (error) {
    console.error("Error getting chart data:", error);
    res.status(500).json({
      error: "Unable to get chart data",
      details: error.message,
    });
  }
};

module.exports = {
  getChartData,
  getMetricData,
};
