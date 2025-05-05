const prismaClient = require("../utils/prismaClient");
const { sendWebhook } = require("../utils/sendWebhook");
const { checkDuplicateLead } = require("../utils/check-duplicate-lead");
const getIpAndCountry = require("../utils/get-ip-and-country");
const {
  chartMetrics,
  generateExtendedReport,
} = require("../utils/chart-functions");

const transformLeadsToChartData = (leads) => {
  // Group leads by date
  const leadsByDate = leads.reduce((acc, lead) => {
    const date = new Date(lead.date).toISOString().split("T")[0];

    if (!acc[date]) {
      acc[date] = {
        date: lead.date,
        lead: 0,
      };
    }

    // Increment lead count for the date
    acc[date].lead += 1;

    return acc;
  }, {});

  // Convert to array and sort by date
  return Object.values(leadsByDate).sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
};
const getLeadsGroupedByDateRouteCampaign = async (leads) => {
  const grouped = {};

  leads.forEach((lead) => {
    const date = lead.date.toISOString().split("T")[0];
    const routeName = lead.route?.name || "Unknown Route";
    const campaignName = lead.campaign?.name || "Unknown Campaign";

    const key = `${date}_${routeName}`;

    if (!grouped[key]) {
      grouped[key] = {
        date,
        route: routeName,
        campaigns: new Set(),
        count: 0,
      };
    }

    grouped[key].campaigns.add(campaignName);
    grouped[key].count += 1;
  });

  // Convert campaigns Set to Array
  return Object.values(grouped).map((item) => ({
    ...item,
    campaigns: Array.from(item.campaigns),
  }));
};

const getLeads = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      campaignIds,
      from,
      to,
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    // Build where clause
    const where = {
      ...(search && {
        OR: [
          { firstName: { contains: search, mode: "insensitive" } },
          { lastName: { contains: search, mode: "insensitive" } },
          { phone: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
        ],
      }),
      ...(status && status !== "all" && { status }),
      ...(campaignIds && {
        campaignId: { in: campaignIds.split(",").map((id) => parseInt(id)) },
      }),
      ...(from &&
        to && {
          createdAt: {
            gte: new Date(from),
            lte: new Date(to),
          },
        }),
    };

    // Get total count for pagination
    const total = await prismaClient.lead.count({ where });

    // Get leads with pagination and filters
    const leads = await prismaClient.lead.findMany({
      where,
      include: {
        campaign: true,
        route: { select: { payout: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });

    res.json({
      leads,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (error) {
    console.error("Error fetching leads:", error);
    res.status(500).json({
      error: "Unable to fetch leads",
      details: error.message,
    });
  }
};

const addLead = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      phone,
      email,
      address,
      sub1,
      sub2,
      sub3,
      sub4,
      campId,
      apiKey,
    } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !phone || !apiKey || !campId) {
      return res.status(400).json({
        error: "Missing required fields",
        required: ["firstName", "lastName", "phone", "apiKey", "campId"],
      });
    }

    const { ip, country } = getIpAndCountry(req);

    // Get user and campaign in a single query
    const userWithCampaign = await prismaClient.user.findUnique({
      where: { apiKey },
      select: {
        id: true,
        campaigns: {
          where: { campId },
          select: {
            id: true,
            routeId: true,
            lead_period: true,
            route: {
              select: {
                url: true,
                method: true,
                attributes: true,
              },
            },
          },
        },
      },
    });

    if (!userWithCampaign) {
      return res.status(400).json({ error: "Invalid API key" });
    }

    const campaign = userWithCampaign.campaigns[0];
    if (!campaign) {
      return res.status(400).json({ error: "Invalid campaign ID" });
    }

    // Check for duplicate lead
    const isDuplicate = await checkDuplicateLead(phone, campaign);
    if (isDuplicate) {
      const duplicateLead = await prismaClient.lead.create({
        data: {
          firstName,
          lastName,
          phone,
          email,
          address,
          ip,
          country,
          status: "Duplicate",
          sub1,
          sub2,
          sub3,
          sub4,
          campaignId: campaign.id,
          routeId: campaign.routeId,
          userId: userWithCampaign.id,
        },
      });
      return res.status(400).json({
        lead_id: duplicateLead.id,
        status: "Duplicate",
      });
    }

    // Create new lead
    const lead = await prismaClient.lead.create({
      data: {
        firstName,
        lastName,
        phone,
        email,
        address,
        ip,
        country,
        status: "Pending",
        sub1,
        sub2,
        sub3,
        sub4,
        campaignId: campaign.id,
        routeId: campaign.routeId,
        userId: userWithCampaign.id,
      },
    });

    // Send webhook in background
    sendWebhook(campaign.route, lead).catch((error) => {
      console.error("Error sending webhook:", error);
    });

    res.status(201).json({ lead_id: lead.id });
  } catch (error) {
    console.error("Error creating lead:", error);
    res.status(400).json({
      error: "Unable to create lead",
      details: error.message,
    });
  }
};

const getLeadsByUser = async (req, res) => {
  try {
    const { userId } = req.auth;
    console.log("User ID from auth:", userId);
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
      if (!campaignIds.length) return res.json([1, 2, 3, 4]);

      where = { campaignId: { in: campaignIds } };
    } else {
      return res.status(403).json({ error: "Unauthorized role" });
    }

    const leads = await prismaClient.lead.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        status: true,
        userId: true,
        date: true,
        routeId: true,
        campaignId: true,
        webhookResponse: true,
        createdAt: true,
        updatedAt: true,
        campaign: {
          select: {
            id: true,
            name: true,
          },
        },
        route: {
          select: {
            payout: true,
            name: true,
          },
        },
      },
    });

    console.log("Leads for user:", leads.length);
    res.status(200).json(leads);
  } catch (error) {
    console.error("Error fetching user leads:", error);
    res.status(500).json({
      error: "Unable to get leads",
      details: error.message,
    });
  }
};

const getLeadsByUserPagination = async (req, res) => {
  const { search = "", page = 1, limit = 10, status = "all" } = req.query;
  const pageNumber = Math.max(Number(page), 1);
  const take = Number(limit);
  const skip = (pageNumber - 1) * take;
  try {
    const { userId } = req.auth;
    if (!userId) return res.status(400).json({ error: "User ID not found" });

    const user = await prismaClient.user.findUnique({
      where: { id: userId },
      select: { role: true, companyId: true, email: true },
    });

    if (!user) return res.status(404).json({ error: "User not found" });

    let where = {};

    if (user.role === "admin") {
      if (!user.companyId)
        return res
          .status(400)
          .json({ error: "Company ID not found for admin" });
      where.user = { companyId: user.companyId };
    } else if (user.role === "webmaster") {
      const webmaster = await prismaClient.webmaster.findUnique({
        where: { email: user.email },
        select: {
          campaigns: {
            select: { id: true },
          },
        },
      });

      if (!webmaster)
        return res.status(404).json({ error: "Webmaster not found" });

      const campaignIds = webmaster.campaigns.map((c) => c.id);
      if (!campaignIds.length) {
        return res.json({
          data: [],
          total: 0,
          page: pageNumber,
          totalPages: 0,
        });
      }

      where.campaignId = { in: campaignIds };
    } else {
      return res.status(403).json({ error: "Unauthorized role" });
    }

    // Search filter
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ];
    }

    // Status filter
    if (status !== "all") {
      where.status = status;
    }

    const [total, leads] = await Promise.all([
      prismaClient.lead.count({ where }),
      prismaClient.lead.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
        include: {
          campaign: { select: { name: true } },
          route: { select: { payout: true, name: true } },
        },
      }),
    ]);

    console.log("Total leads:", total);

    return res.json({
      leads: leads,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / take),
    });
  } catch (error) {
    console.error("Error fetching user leads:", error);
    return res.status(500).json({
      error: "Unable to get leads",
      details: error.message,
    });
  }
};

const getChartData = async (req, res) => {
  try {
    const { userId } = req.auth;
    if (!userId) {
      return res.status(400).json({ error: "User ID not found" });
    }

    // Get user info first
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

const getMonthlyLeadsByUser = async (req, res) => {
  try {
    const { userId } = req.auth;
    console.log("User ID from auth monthly:", userId);
    if (!userId) {
      console.log("User ID not found");
      return res.status(400).json({ error: "User ID not found" });
    }

    const user = await prismaClient.user.findUnique({
      where: { id: userId },
      select: { role: true, companyId: true, email: true },
    });

    if (!user) {
      console.log("User not found");
      return res.status(404).json({ error: "User not found" });
    }

    let where = {};
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999
    );

    if (user.role === "admin") {
      if (!user.companyId) {
        return res
          .status(400)
          .json({ error: "Company ID not found for admin" });
      }
      where = {
        user: { companyId: user.companyId },
        createdAt: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      };
    } else if (user.role === "webmaster") {
      const webmaster = await prismaClient.webmaster.findUnique({
        where: { email: user.email },
        select: { campaigns: { select: { id: true } } },
      });

      if (!webmaster) {
        console.log("Webmaster not found");
        return res.status(404).json({ error: "Webmaster not found" });
      }

      const campaignIds = webmaster.campaigns.map((c) => c.id);
      if (!campaignIds.length) return res.json([]);

      where = {
        campaignId: { in: campaignIds },
        createdAt: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      };
    } else {
      return res.status(403).json({ error: "Unauthorized role" });
    }

    const leads = await prismaClient.lead.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        status: true,
        userId: true,
        date: true,
        routeId: true,
        campaignId: true,
        webhookResponse: true,
        createdAt: true,
        updatedAt: true,
        campaign: {
          select: {
            id: true,
            name: true,
          },
        },
        route: {
          select: {
            payout: true,
            name: true,
          },
        },
      },
    });

    console.log("Monthly leads for user:", leads.length);
    res.status(200).json(leads);
  } catch (error) {
    console.error("Error fetching monthly leads:", error);
    res.status(500).json({
      error: "Unable to get monthly leads",
      details: error.message,
    });
  }
};

const getPastTenDaysLeadsByUser = async (req, res) => {
  try {
    const { userId } = req.auth;
    console.log("User ID from auth 10 days:", userId);
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

    let where = {};
    const now = new Date();
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(now.getDate() - 10);
    const nowTime = new Date(); // for upper bound

    if (user.role === "admin") {
      if (!user.companyId) {
        return res
          .status(400)
          .json({ error: "Company ID not found for admin" });
      }
      where = {
        user: { companyId: user.companyId },
        createdAt: {
          gte: tenDaysAgo,
          lte: nowTime,
        },
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
      if (!campaignIds.length) return res.json([]);

      where = {
        campaignId: { in: campaignIds },
        createdAt: {
          gte: tenDaysAgo,
          lte: nowTime,
        },
      };
    } else {
      return res.status(403).json({ error: "Unauthorized role" });
    }

    const leads = await prismaClient.lead.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        status: true,
        userId: true,
        date: true,
        routeId: true,
        campaignId: true,
        webhookResponse: true,
        createdAt: true,
        updatedAt: true,
        campaign: {
          select: {
            id: true,
            name: true,
          },
        },
        route: {
          select: {
            payout: true,
            name: true,
          },
        },
      },
    });

    console.log("Monthly leads for user:", leads.length);
    res.status(200).json(leads);
  } catch (error) {
    console.error("Error fetching monthly leads:", error);
    res.status(500).json({
      error: "Unable to get monthly leads",
      details: error.message,
    });
  }
};
module.exports = {
  getLeads,
  addLead,
  getLeadsByUser,
  getChartData,
  getLeadsByUserPagination,
  getMonthlyLeadsByUser,
  getPastTenDaysLeadsByUser,
};
