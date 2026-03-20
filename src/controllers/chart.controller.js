const prismaClient = require("../utils/prismaClient");
const logger = require("../utils/logger");
const {
  chartMetrics,
  generateExtendedReport,
  getLeadsGroupedByDateRouteCampaign,
} = require("../utils/chart-functions");

const getChartData = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 2000, 100), 5000);
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 90);
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const { userId } = req.auth;
    if (!userId) {
      return res.status(400).json({ error: "User ID not found" });
    }

    const user = await prismaClient.user.findUnique({
      where: { id: userId },
      select: { role: true, organizationId: true, email: true },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Setup the where clause based on user role
    let where = {};

    if (user.role === "admin") {
      if (!user.organizationId) {
        return res
          .status(400)
          .json({ error: "Organization ID not found for admin" });
      }
      where = {
        user: { organizationId: user.organizationId },
        createdAt: { gte: startDate },
      };
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

      where = {
        campaignId: { in: campaignIds },
        createdAt: { gte: startDate },
      };
    } else {
      return res.status(403).json({ error: "Unauthorized role" });
    }

    const leads = await prismaClient.lead.findMany({
      where,
      include: {
        campaign: { select: { name: true, campId: true } },
        route: { select: { payout: true, name: true, routeId: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    const extendedReport = generateExtendedReport(leads);
    const responseData = {
      newChartData: await getLeadsGroupedByDateRouteCampaign(leads),
      totalLeads: leads.length,
      metricData: chartMetrics(leads),
      extendedReport,
      meta: { days, limit, returned: leads.length },
    };

    res.json(responseData);
  } catch (error) {
    logger.error({ err: error }, "Error getting chart data");
    res.status(500).json({
      error: "Unable to get chart data",
      details: error.message,
    });
  }
};

const getMetricData = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 2000, 100), 5000);
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 90);
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const { userId } = req.auth;
    if (!userId) {
      return res.status(400).json({ error: "User ID not found" });
    }

    const user = await prismaClient.user.findUnique({
      where: { id: userId },
      select: { role: true, organizationId: true, email: true },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Setup the where clause based on user role
    let where = {};

    if (user.role === "admin") {
      if (!user.organizationId) {
        return res
          .status(400)
          .json({ error: "Organization ID not found for admin" });
      }
      where = {
        user: { organizationId: user.organizationId },
        createdAt: { gte: startDate },
      };
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

      where = {
        campaignId: { in: campaignIds },
        createdAt: { gte: startDate },
      };
    } else {
      return res.status(403).json({ error: "Unauthorized role" });
    }

    const leads = await prismaClient.lead.findMany({
      where,
      include: {
        campaign: { select: { name: true, campId: true } },
        route: { select: { payout: true, name: true, routeId: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    const metricData = await chartMetrics(leads);
    res.status(200).json({ metricData, meta: { days, limit, returned: leads.length } });
  } catch (error) {
    logger.error({ err: error }, "Error getting metric data");
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
