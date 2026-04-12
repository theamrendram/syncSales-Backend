const prismaClient = require("../utils/prismaClient");
const { getCampaignIdsForWebmaster } = require("../utils/webmaster-campaigns");

const CAMPAIGN_MUTABLE_FIELDS = [
  "name",
  "campId",
  "manager",
  "routeId",
  "lead_period",
];

const getMissingRequiredFields = (body) =>
  CAMPAIGN_MUTABLE_FIELDS.filter((field) => body[field] === undefined);

const buildCampaignPayload = (body, userId, organizationId) => {
  const leadPeriod = Number(body.lead_period);
  return {
    name: body.name,
    campId: body.campId,
    userId,
    routeId: body.routeId,
    manager: body.manager,
    lead_period: leadPeriod,
    organizationId,
  };
};

const campaignSelect = {
  id: true,
  name: true,
  userId: true,
  routeId: true,
  campId: true,
  status: true,
  manager: true,
  createdAt: true,
  lead_period: true,
  updatedAt: true,
  organizationId: true,
  isArchived: true,
  route: {
    select: {
      id: true,
      name: true,
      product: true,
      method: true,
      url: true,
      payout: true,
      hasWebhook: true,
      organizationId: true,
      deletedAt: true,
    },
  },
};

const getCampaigns = async (req, res) => {
  try {
    const take = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const ctx = req.authContext;
    const where = {
      organizationId: req.organizationId,
      isArchived: false,
    };

    if (ctx?.isWebmaster) {
      const ids = await getCampaignIdsForWebmaster(
        ctx.userId,
        ctx.organizationId,
      );
      if (!ids.length) {
        return res.status(200).json({
          success: true,
          data: [],
          meta: { limit: take },
        });
      }
      where.id = { in: ids };
    }

    // Compatibility shape: allow ?userId=... but do not trust it for authorization.
    // If userId filter is requested, filter by the authenticated user only.
    if (req.query.userId !== undefined) {
      where.userId = req.auth.userId;
    }

    const campaigns = await prismaClient.campaign.findMany({
      where,
      select: campaignSelect,
      orderBy: { createdAt: "desc" },
      take,
    });

    return res.status(200).json({
      success: true,
      data: campaigns,
      meta: { limit: take },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Unable to fetch campaigns",
      details: error.message,
    });
  }
};

const getCampaignById = async (req, res) => {
  const { id } = req.params;
  try {
    const ctx = req.authContext;
    if (ctx?.isWebmaster) {
      const allowed = await getCampaignIdsForWebmaster(
        ctx.userId,
        ctx.organizationId,
      );
      if (!allowed.includes(id)) {
        return res
          .status(404)
          .json({ success: false, error: "Campaign not found" });
      }
    }

    const campaign = await prismaClient.campaign.findFirst({
      where: {
        id,
        organizationId: req.organizationId,
        isArchived: false,
      },
      select: campaignSelect,
    });

    if (!campaign) {
      return res
        .status(404)
        .json({ success: false, error: "Campaign not found" });
    }

    return res.status(200).json({ success: true, data: campaign });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Unable to get campaign",
      details: error.message,
    });
  }
};

const addCampaign = async (req, res) => {
  try {
    const missingFields = getMissingRequiredFields(req.body);
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
        details: `Required fields: ${missingFields.join(", ")}`,
      });
    }

    const userId = req.auth.userId;
    const { routeId } = req.body;
    const leadPeriod = Number(req.body.lead_period);
    if (!Number.isFinite(leadPeriod)) {
      return res.status(400).json({
        success: false,
        error: "lead_period must be a valid number",
      });
    }

    const route = await prismaClient.route.findFirst({
      where: {
        id: routeId,
        organizationId: req.organizationId,
        deletedAt: null,
      },
      select: { organizationId: true },
    });

    if (!route) {
      return res.status(400).json({
        success: false,
        error: "routeId must belong to your active organization",
      });
    }

    const campaign = await prismaClient.campaign.create({
      data: {
        ...buildCampaignPayload(req.body, userId, req.organizationId),
      },
    });

    return res.status(201).json({ success: true, data: campaign });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Unable to create campaign",
      details: error.message,
    });
  }
};

const editCampaign = async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await prismaClient.campaign.findFirst({
      where: { id, organizationId: req.organizationId, isArchived: false },
    });
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, error: "Campaign not found" });
    }

    const missingFields = getMissingRequiredFields(req.body);
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields for PUT update",
        details: `Required fields: ${missingFields.join(", ")}`,
      });
    }

    const userId = req.auth.userId;
    const { routeId } = req.body;
    const leadPeriod = Number(req.body.lead_period);
    if (!Number.isFinite(leadPeriod)) {
      return res.status(400).json({
        success: false,
        error: "lead_period must be a valid number",
      });
    }

    const route = await prismaClient.route.findFirst({
      where: {
        id: routeId,
        organizationId: req.organizationId,
        deletedAt: null,
      },
      select: { organizationId: true },
    });
    if (!route) {
      return res.status(400).json({
        success: false,
        error: "routeId must belong to your active organization",
      });
    }

    const campaign = await prismaClient.campaign.update({
      where: { id },
      data: {
        ...buildCampaignPayload(req.body, userId, req.organizationId),
      },
    });

    return res.status(200).json({ success: true, data: campaign });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Unable to update campaign",
      details: error.message,
    });
  }
};

const deleteCampaign = async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await prismaClient.campaign.findFirst({
      where: { id, organizationId: req.organizationId, isArchived: false },
    });
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, error: "Campaign not found" });
    }

    const campaign = await prismaClient.campaign.update({
      where: { id },
      data: {
        isArchived: true,
        updatedAt: new Date(),
      },
    });

    return res.status(200).json({
      success: true,
      data: { id: campaign.id },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Unable to archive campaign",
      details: error.message,
    });
  }
};
module.exports = {
  getCampaigns,
  getCampaignById,
  addCampaign,
  editCampaign,
  deleteCampaign,
};
