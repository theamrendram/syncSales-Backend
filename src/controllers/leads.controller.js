const prismaClient = require("../utils/prismaClient");
const { sendWebhook } = require("../utils/sendWebhook");
const { checkDuplicateLead } = require("../utils/check-duplicate-lead");
const getIpAndCountry = require("../utils/get-ip-and-country");
const { clerkClient } = require("@clerk/express");

const transformLeadsToChartData = (leads) => {
  if (!leads || !Array.isArray(leads)) return [];

  return leads.reduce((acc, lead) => {
    const date = new Date(lead.date).toISOString().split("T")[0];
    acc[date] = (acc[date] || 0) + 1;
    return acc;
  }, {});
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
    if (!userId) {
      return res.status(400).json({ error: "User ID not found" });
    }

    // Get user details
    const user = await prismaClient.user.findUnique({
      where: { id: userId },
      select: { role: true, companyId: true, email: true },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Build where clause based on user role
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
      if (!campaignIds.length) return res.json([]);

      where = { campaignId: { in: campaignIds } };
    } else {
      return res.status(403).json({ error: "Unauthorized role" });
    }

    // Get leads with proper includes
    const leads = await prismaClient.lead.findMany({
      where,
      include: {
        campaign: true,
        route: { select: { payout: true, name: true } },
      },
    });

    res.json(leads);
  } catch (error) {
    console.error("Error fetching user leads:", error);
    res.status(500).json({
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

    // Get all required data in parallel
    const [leads, campaigns, routes] = await Promise.all([
      prismaClient.lead.findMany({ where: { userId } }),
      prismaClient.campaign.findMany({
        where: { userId },
        select: { id: true, name: true },
      }),
      prismaClient.route.findMany({
        where: { userId },
        select: { id: true, name: true },
      }),
    ]);

    const chartData = transformLeadsToChartData(leads);
    const responseData = {
      campaigns,
      routes,
      chartData,
      totalLeads: leads.length,
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

module.exports = {
  getLeads,
  addLead,
  getLeadsByUser,
  getChartData,
};
