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
const logger = require("../utils/logger");

const MAX_PAGE_LIMIT = 100;
const MAX_EXPORT_LIMIT = 1000;
const leadModelHasOrgLeadId = !!prismaClient?._runtimeDataModel?.models?.Lead?.fields?.some(
  (field) => field.name === "orgLeadId"
);

const leadListSelect = {
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
  campaign: { select: { id: true, name: true } },
  route: { select: { payout: true, name: true } },
};

const getUserWithMemberships = async (userId) =>
  prismaClient.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      webmasterProfile: { select: { userId: true } },
      organizationMemberships: {
        where: { status: "active" },
        select: {
          organizationId: true,
          role: { select: { name: true, permissions: true } },
        },
      },
    },
  });

const getLeadAccessWhereForUser = async (user, organizationId) => {
  if (user.webmasterProfile) {
    if (!organizationId) {
      return { where: null, isForbidden: true };
    }
    const assignedCampaigns = await prismaClient.campaign.findMany({
      where: { webmasterUserId: user.id, organizationId },
      select: { id: true },
    });
    const campaignIds = assignedCampaigns.map((c) => c.id);
    if (!campaignIds.length) {
      return { where: null, isEmpty: true };
    }
    return {
      where: { organizationId, campaignId: { in: campaignIds } },
      isEmpty: false,
    };
  }

  if (organizationId) {
    const membership = user.organizationMemberships.find(
      (m) => m.organizationId === organizationId
    );
    if (!membership) {
      return { where: null, isForbidden: true };
    }
    return { where: { organizationId }, isEmpty: false };
  }

  const userOrgIds = user.organizationMemberships.map((m) => m.organizationId);
  if (!userOrgIds.length) {
    return { where: null, isEmpty: true };
  }
  return { where: { organizationId: { in: userOrgIds } }, isEmpty: false };
};


const getLeads = async (req, res) => {
  try {
    const ctx = req.authContext;
    if (!ctx?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const {
      page = 1,
      limit = 10,
      search,
      status,
      campaignIds,
      from,
      to,
      organizationId: queryOrganizationId,
    } = req.query;

    if (
      queryOrganizationId != null &&
      String(queryOrganizationId).trim() !== ""
    ) {
      if (ctx.isWebmaster) {
        if (
          !ctx.organizationId ||
          String(queryOrganizationId) !== ctx.organizationId
        ) {
          return res.status(403).json({ error: "Forbidden" });
        }
      }
      if (
        !ctx.organizationId ||
        String(queryOrganizationId) !== ctx.organizationId
      ) {
        return res.status(403).json({ error: "Forbidden" });
      }
    }

    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
    const take = Math.min(Math.max(parseInt(limit, 10) || 10, 1), MAX_PAGE_LIMIT);
    const skip = (pageNumber - 1) * take;

    let scopeWhere = {};
    if (ctx.isWebmaster) {
      if (!ctx.organizationId) {
        return res.status(403).json({
          error: "Forbidden",
          message: "No organization context",
        });
      }
      const assignedCampaigns = await prismaClient.campaign.findMany({
        where: { webmasterUserId: ctx.userId, organizationId: ctx.organizationId },
        select: { id: true },
      });
      const ids = assignedCampaigns.map((c) => c.id);
      if (!ids.length) {
        return res.json({
          leads: [],
          total: 0,
          page: pageNumber,
          limit: take,
        });
      }
      scopeWhere = { organizationId: ctx.organizationId, campaignId: { in: ids } };
    } else {
      if (!ctx.organizationId) {
        return res.status(403).json({
          error: "Forbidden",
          message: "No organization context",
        });
      }
      scopeWhere = { organizationId: ctx.organizationId };
    }

    const where = {
      ...scopeWhere,
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
        campaignId: {
          in: campaignIds
            .split(",")
            .map((id) => String(id).trim())
            .filter(Boolean),
        },
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
      page: pageNumber,
      limit: take,
    });
  } catch (error) {
    logger.error({ err: error }, "Error fetching leads");
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

    // Get user and campaign in a single query with organization context
    const userWithCampaign = await prismaClient.user.findUnique({
      where: { apiKey },
      select: {
        id: true,
        webmasterProfile: {
          select: { isActive: true },
        },
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
        ownedCampaigns: {
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
        assignedWebmasterCampaigns: {
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

    const campaign =
      userWithCampaign.ownedCampaigns[0] ||
      userWithCampaign.assignedWebmasterCampaigns[0];
    if (!campaign) {
      return res.status(400).json({ error: "Invalid campaign ID" });
    }

    if (userWithCampaign.webmasterProfile) {
      if (!userWithCampaign.webmasterProfile.isActive) {
        return res.status(403).json({ error: "Webmaster account is inactive" });
      }
      if (!userWithCampaign.assignedWebmasterCampaigns[0]) {
        return res.status(403).json({ error: "Access denied to this campaign" });
      }
    } else {
      const userMembership = userWithCampaign.organizationMemberships.find(
        (membership) => membership.organizationId === campaign.organizationId
      );

      if (!userMembership) {
        return res
          .status(403)
          .json({ error: "Access denied to this organization" });
      }
    }

    // Check for duplicate lead
    const isDuplicate = await checkDuplicateLead(phone, campaign);
    const organizationId = campaign.organizationId;

    const createLeadWithOrgCounter = async (leadCreateData) => {
      if (!organizationId) {
        return prismaClient.lead.create({ data: leadCreateData });
      }
      return prismaClient.$transaction(async (tx) => {
        const counterRows = await tx.$queryRaw`
          INSERT INTO "OrgLeadCounter" ("organizationId", "nextValue")
          VALUES (${organizationId}, 1)
          ON CONFLICT ("organizationId")
          DO UPDATE SET "nextValue" = "OrgLeadCounter"."nextValue" + 1
          RETURNING "nextValue";
        `;
        const orgLeadId = Number(counterRows?.[0]?.nextValue || 1);

        return tx.lead.create({
          data: {
            ...leadCreateData,
            organizationId,
            ...(leadModelHasOrgLeadId ? { orgLeadId } : {}),
          },
        });
      });
    };

    if (isDuplicate) {
      const duplicateLead = await createLeadWithOrgCounter({
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
        routeId: campaign.routeId,
        campaignId: campaign.id,
      });

      return res.json({
        success: false,
        message: "Duplicate lead detected",
        lead: duplicateLead,
      });
    }

    // Create new lead
    const newLead = await createLeadWithOrgCounter({
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
      routeId: campaign.routeId,
      campaignId: campaign.id,
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
        logger.error({ err: webhookError }, "Webhook error");
        // Continue even if webhook fails
      }
    }

    res.json({
      success: true,
      message: "Lead added successfully",
      lead: newLead,
    });
  } catch (error) {
    logger.error({ err: error }, "Error adding lead");
    res.status(500).json({
      error: "Unable to add lead",
      details: error.message,
    });
  }
};

const getLeadsByUser = async (req, res) => {
  try {
    const { userId } = req.auth;
    const ctx = req.authContext;
    const { organizationId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "User ID not found" });
    }

    const requestedOrg =
      organizationId != null && String(organizationId).trim() !== ""
        ? String(organizationId)
        : null;
    const resolvedOrg = requestedOrg ?? ctx?.organizationId;

    if (!ctx?.organizationId) {
      return res.status(403).json({
        error: "Forbidden",
        message: "No organization context",
      });
    }
    if (requestedOrg && requestedOrg !== ctx.organizationId) {
      return res.status(403).json({
        error: "Access denied. You are not a member of this organization.",
      });
    }

    const user = await getUserWithMemberships(userId);

    if (!user) return res.status(404).json({ error: "User not found" });

    const access = await getLeadAccessWhereForUser(
      user,
      resolvedOrg,
    );
    if (access.isForbidden) {
      return res.status(403).json({
        error: "Access denied. You are not a member of this organization.",
      });
    }
    if (access.isEmpty) {
      return res.json([]);
    }

    const exportLimit = Math.min(
      Math.max(Number(req.query.limit) || 200, 1),
      MAX_EXPORT_LIMIT
    );
    const leads = await prismaClient.lead.findMany({
      where: access.where,
      select: leadListSelect,
      orderBy: { createdAt: "desc" },
      take: exportLimit,
    });
    res.status(200).json(leads);
  } catch (error) {
    logger.error({ err: error }, "Error fetching user leads");
    res.status(500).json({ error: "Unable to get leads", details: error.message });
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
  const pageNumber = Math.max(Number(page) || 1, 1);
  const take = Math.min(Math.max(Number(limit) || 10, 1), MAX_PAGE_LIMIT);
  const skip = (pageNumber - 1) * take;

  try {
    const { userId } = req.auth;
    const ctx = req.authContext;
    if (!userId) return res.status(400).json({ error: "User ID not found" });

    const requestedOrg =
      organizationId != null && String(organizationId).trim() !== ""
        ? String(organizationId)
        : null;
    const resolvedOrg = requestedOrg ?? ctx?.organizationId;

    if (!ctx?.organizationId) {
      return res.status(403).json({
        error: "Forbidden",
        message: "No organization context",
      });
    }
    if (requestedOrg && requestedOrg !== ctx.organizationId) {
      return res.status(403).json({
        error: "Access denied. You are not a member of this organization.",
      });
    }

    const user = await getUserWithMemberships(userId);

    if (!user) return res.status(404).json({ error: "User not found" });

    const access = await getLeadAccessWhereForUser(
      user,
      resolvedOrg,
    );
    if (access.isForbidden) {
      return res.status(403).json({
        error: "Access denied. You are not a member of this organization.",
      });
    }
    if (access.isEmpty) {
      return res.json({ data: [], total: 0, page: pageNumber, totalPages: 0 });
    }
    const where = { ...access.where };

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

    const total = await prismaClient.lead.count({ where });

    const leads = await prismaClient.lead.findMany({
      where,
      select: leadListSelect,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });

    const totalPages = Math.ceil(total / take);
    res.json({ data: leads, total, page: pageNumber, totalPages });
  } catch (error) {
    logger.error({ err: error }, "Error fetching paginated leads");
    res.status(500).json({ error: "Unable to get leads", details: error.message });
  }
};

const getMonthlyLeadsByUser = async (req, res) => {
  try {
    const { userId } = req.auth;
    const ctx = req.authContext;

    if (!userId) {
      return res.status(400).json({ error: "User ID not found" });
    }

    let where = {};
    const now = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(now.getDate() - 30);

    if (ctx?.isWebmaster) {
      const assignedCampaigns = await prismaClient.campaign.findMany({
        where: { webmasterUserId: userId, organizationId: ctx.organizationId },
        select: { id: true },
      });
      const campaignIds = assignedCampaigns.map((c) => c.id);
      if (!campaignIds.length) return res.json([]);

      where = {
        organizationId: ctx.organizationId,
        campaignId: { in: campaignIds },
        createdAt: {
          gte: thirtyDaysAgo,
          lte: now,
        },
      };
    } else if (ctx?.organizationId) {
      where = {
        organizationId: ctx.organizationId,
        createdAt: {
          gte: thirtyDaysAgo,
          lte: now,
        },
      };
    } else {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const exportLimit = Math.min(
      Math.max(Number(req.query.limit) || 500, 1),
      MAX_EXPORT_LIMIT
    );
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
        sub3: true,
        sub4: true,
        ip: true,
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
      take: exportLimit,
    });
    res.status(200).json(leads);
  } catch (error) {
    logger.error({ err: error }, "Error fetching leads from past 30 days");
    res.status(500).json({
      error: "Unable to get leads from past 30 days",
      details: error.message,
    });
  }
};

const getPastTenDaysLeadsByUser = async (req, res) => {
  try {
    const { userId } = req.auth;
    const ctx = req.authContext;
    if (!userId) {
      return res.status(400).json({ error: "User ID not found" });
    }

    let where = {};
    const now = new Date();
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(now.getDate() - 10);
    const nowTime = new Date();

    if (ctx?.isWebmaster) {
      const assignedCampaigns = await prismaClient.campaign.findMany({
        where: { webmasterUserId: userId, organizationId: ctx.organizationId },
        select: { id: true },
      });
      const campaignIds = assignedCampaigns.map((c) => c.id);
      if (!campaignIds.length) return res.json([]);

      where = {
        organizationId: ctx.organizationId,
        campaignId: { in: campaignIds },
        createdAt: {
          gte: tenDaysAgo,
          lte: nowTime,
        },
      };
    } else if (ctx?.organizationId) {
      where = {
        organizationId: ctx.organizationId,
        createdAt: {
          gte: tenDaysAgo,
          lte: nowTime,
        },
      };
    } else {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const exportLimit = Math.min(
      Math.max(Number(req.query.limit) || 500, 1),
      MAX_EXPORT_LIMIT
    );
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
      orderBy: { createdAt: "desc" },
      take: exportLimit,
    });
    res.status(200).json(leads);
  } catch (error) {
    logger.error({ err: error }, "Error fetching monthly leads");
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
