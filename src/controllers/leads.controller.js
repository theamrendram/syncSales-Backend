const prismaClient = require("../utils/prismaClient");
const { sendWebhook } = require("../utils/sendWebhook");
const { checkDuplicateLead } = require("../utils/check-duplicate-lead");
const getIpAndCountry = require("../utils/get-ip-and-country");
const {
  chartMetrics,
  generateExtendedReport,
  transformLeadsToChartData,
  getLeadsGroupedByDateRouteCampaign,
} = require("../utils/chart-functions");
const { addOrganizationFilter } = require("../utils/organization-utils");


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
      organizationId,
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    // Build where clause with organization filter
    const where = addOrganizationFilter(
      {
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
      },
      organizationId
    );

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

    console.log("addLead", req.body);
    // Validate required fields
    if (!firstName || !lastName || !phone || !apiKey || !campId) {
      return res.status(400).json({
        error: "Missing required fields",
        required: ["firstName", "lastName", "phone", "apiKey", "campId"],
      });
    }

    const { ip, country } = getIpAndCountry(req);

    // Get user and campaign in a single query with organization context
    const userWithCampaign = await prismaClient.user.findUnique({
      where: { apiKey },
      select: {
        id: true,
        organizationMemberships: {
          where: { status: "active" },
          select: {
            organizationId: true,
            role: {
              select: {
                permissions: true,
              },
            },
          },
        },
        campaigns: {
          where: { campId },
          select: {
            id: true,
            routeId: true,
            lead_period: true,
            organizationId: true,
            route: {
              select: {
                url: true,
                method: true,
                attributes: true,
                organizationId: true,
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

    // Check if user has permission to add leads in this organization
    const userMembership = userWithCampaign.organizationMemberships.find(
      (membership) => membership.organizationId === campaign.organizationId
    );

    if (!userMembership) {
      return res
        .status(403)
        .json({ error: "Access denied to this organization" });
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
          sub1,
          sub2,
          sub3,
          sub4,
          status: "duplicate",
          userId: userWithCampaign.id,
          organizationId: campaign.organizationId,
          routeId: campaign.routeId,
          campaignId: campaign.id,
        },
      });

      return res.json({
        success: false,
        message: "Duplicate lead detected",
        lead: duplicateLead,
      });
    }

    // Create new lead
    const newLead = await prismaClient.lead.create({
      data: {
        firstName,
        lastName,
        phone,
        email,
        address,
        ip,
        country,
        sub1,
        sub2,
        sub3,
        sub4,
        status: "new",
        userId: userWithCampaign.id,
        organizationId: campaign.organizationId,
        routeId: campaign.routeId,
        campaignId: campaign.id,
      },
    });

    // Send webhook if configured
    if (campaign.route.url && campaign.route.method) {
      try {
        const webhookResponse = await sendWebhook(
          campaign.route.url,
          campaign.route.method,
          campaign.route.attributes,
          newLead
        );

        // Update lead with webhook response
        await prismaClient.lead.update({
          where: { id: newLead.id },
          data: { webhookResponse },
        });
      } catch (webhookError) {
        console.error("Webhook error:", webhookError);
        // Continue even if webhook fails
      }
    }

    res.json({
      success: true,
      message: "Lead added successfully",
      lead: newLead,
    });
  } catch (error) {
    console.error("Error adding lead:", error);
    res.status(500).json({
      error: "Unable to add lead",
      details: error.message,
    });
  }
};

const getLeadsByUser = async (req, res) => {
  try {
    const { userId } = req.auth;
    const { organizationId } = req.query; // Add organization filter

    console.log("User ID from auth:", userId);
    if (!userId) {
      return res.status(400).json({ error: "User ID not found" });
    }

    // Get user with organization memberships
    const user = await prismaClient.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        organizationMemberships: {
          where: { status: "active" },
          select: {
            organizationId: true,
            role: {
              select: {
                name: true,
                permissions: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // If organizationId is provided, check if user is member of that organization
    if (organizationId) {
      const membership = user.organizationMemberships.find(
        (m) => m.organizationId === organizationId
      );

      if (!membership) {
        return res.status(403).json({
          error: "Access denied. You are not a member of this organization.",
        });
      }
    }

    // Build where clause with organization filter
    let where = {};

    if (organizationId) {
      // Filter by specific organization
      where.organizationId = organizationId;
    } else {
      // Filter by all organizations user is member of
      const userOrgIds = user.organizationMemberships.map(
        (m) => m.organizationId
      );
      if (userOrgIds.length > 0) {
        where.organizationId = { in: userOrgIds };
      } else {
        // User has no organizations, return empty result
        return res.json([]);
      }
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
        organizationId: true,
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
  const {
    search = "",
    page = 1,
    limit = 10,
    status = "all",
    organizationId,
  } = req.query;
  const pageNumber = Math.max(Number(page), 1);
  const take = Number(limit);
  const skip = (pageNumber - 1) * take;

  try {
    const { userId } = req.auth;
    if (!userId) return res.status(400).json({ error: "User ID not found" });

    // Get user with organization memberships
    const user = await prismaClient.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        organizationMemberships: {
          where: { status: "active" },
          select: {
            organizationId: true,
            role: {
              select: {
                name: true,
                permissions: true,
              },
            },
          },
        },
      },
    });

    if (!user) return res.status(404).json({ error: "User not found" });

    // If organizationId is provided, check if user is member of that organization
    if (organizationId) {
      const membership = user.organizationMemberships.find(
        (m) => m.organizationId === organizationId
      );

      if (!membership) {
        return res.status(403).json({
          error: "Access denied. You are not a member of this organization.",
        });
      }
    }

    // Build where clause with organization filter
    let where = {};

    if (organizationId) {
      // Filter by specific organization
      where.organizationId = organizationId;
    } else {
      // Filter by all organizations user is member of
      const userOrgIds = user.organizationMemberships.map(
        (m) => m.organizationId
      );
      if (userOrgIds.length > 0) {
        where.organizationId = { in: userOrgIds };
      } else {
        // User has no organizations, return empty result
        return res.json({
          data: [],
          total: 0,
          page: pageNumber,
          totalPages: 0,
        });
      }
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
    if (status && status !== "all") {
      where.status = status;
    }

    // Get total count
    const total = await prismaClient.lead.count({ where });

    // Get leads with pagination
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
        organizationId: true,
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
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });

    const totalPages = Math.ceil(total / take);

    res.json({
      data: leads,
      total,
      page: pageNumber,
      totalPages,
    });
  } catch (error) {
    console.error("Error fetching paginated leads:", error);
    res.status(500).json({
      error: "Unable to get leads",
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
      select: { role: true, organizationId: true, email: true },
    });

    if (!user) {
      console.log("User not found");
      return res.status(404).json({ error: "User not found" });
    }

    let where = {};
    const now = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(now.getDate() - 30);

    if (user.role === "admin") {
      if (!user.organizationId) {
        return res
          .status(400)
          .json({ error: "Organization ID not found for admin" });
      }

      where = {
        user: { organizationId: user.organizationId },
        createdAt: {
          gte: thirtyDaysAgo,
          lte: now,
        },
      };
    } else if (user.role === "webmaster") {
      console.log("Webmaster found at get monthly leads by user", user.email);
      const webmaster = await prismaClient.webmaster.findUnique({
        where: { email: user.email },
        select: { campaigns: { select: { id: true } } },
      });

      if (!webmaster) {
        console.log("Webmaster not found at get monthly leads by user");
        return res.status(404).json({ error: "Webmaster not found" });
      }

      const campaignIds = webmaster.campaigns.map((c) => c.id);
      if (!campaignIds.length) return res.json([]);

      where = {
        campaignId: { in: campaignIds },
        createdAt: {
          gte: thirtyDaysAgo,
          lte: now,
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
        sub1: true,
        sub2: true,
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

    console.log("Leads from past 30 days for user:", leads.length);
    res.status(200).json(leads);
  } catch (error) {
    console.error("Error fetching leads from past 30 days:", error);
    res.status(500).json({
      error: "Unable to get leads from past 30 days",
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
      select: { role: true, organizationId: true, email: true },
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
      if (!user.organizationId) {
        return res
          .status(400)
          .json({ error: "Organization ID not found for admin" });
      }
      where = {
        user: { organizationId: user.organizationId },
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
  getLeadsByUserPagination,
  getMonthlyLeadsByUser,
  getPastTenDaysLeadsByUser,
};
