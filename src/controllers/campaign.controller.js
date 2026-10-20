import prismaClient from "../utils/core/prismaClient.js";
import { requireScope } from "../middlewares/scope.middleware.js";

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

/**
 * A publisher sees a campaign's route by name only. The route's url and method
 * point at the client's CRM, which is not an outside lead source's business —
 * see PUBLISHER_ROUTE_SELECT in route.controller.js.
 */
const campaignSelectFor = (req) =>
  req.authContext?.membership?.role === "publisher"
    ? {
        ...campaignSelect,
        route: { select: { id: true, name: true, product: true, payout: true } },
      }
    : campaignSelect;

const getCampaigns = async (req, res) => {
  try {
    const take = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const scope = requireScope(req);

    // Entitled to nothing, which is an answer rather than a query.
    if (scope.empty) {
      return res.status(200).json({
        success: true,
        data: [],
        meta: { limit: take },
      });
    }

    const where = {
      ...scope.where,
      isArchived: false,
    };

    // Compatibility shape: allow ?userId=... but do not trust it for authorization.
    // If userId filter is requested, filter by the authenticated user only.
    if (req.query.userId !== undefined) {
      where.userId = req.auth.userId;
    }

    const campaigns = await prismaClient.campaign.findMany({
      where,
      select: campaignSelectFor(req),
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
    const scope = requireScope(req);

    // One query asks both questions: does it exist, and is it in scope. A row
    // outside the scope is absent rather than forbidden — saying "forbidden"
    // would confirm the id is real.
    const campaign = scope.empty
      ? null
      : await prismaClient.campaign.findFirst({
          // AND rather than a spread: a webmaster's scope constrains `id`
          // itself, and merging would let it overwrite the id being requested.
          where: { AND: [{ id }, scope.where, { isArchived: false }] },
          select: campaignSelectFor(req),
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
export { getCampaigns, getCampaignById, addCampaign, editCampaign, deleteCampaign };
