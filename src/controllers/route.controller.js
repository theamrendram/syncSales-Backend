const prismaClient = require("../utils/prismaClient");
const logger = require("../utils/logger");
const { getRouteIdsForWebmaster } = require("../utils/webmaster-campaigns");

const ROUTE_MUTABLE_FIELDS = [
  "name",
  "product",
  "description",
  "payout",
  "url",
  "method",
  "attributes",
];

const buildRoutePayload = (body) => {
  const payload = {
    name: body.name,
    product: body.product,
    description: body.description,
    payout: body.payout,
    url: body.url,
    method: body.method,
    attributes: body.attributes,
  };
  payload.hasWebhook = Boolean(payload.url);
  return payload;
};

const getMissingRequiredFields = (body) =>
  ROUTE_MUTABLE_FIELDS.filter((field) => body[field] === undefined);

const getRoutes = async (req, res) => {
  try {
    const take = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const ctx = req.authContext;
    const where = {
      organizationId: req.organizationId,
      deletedAt: null,
    };

    if (ctx?.isWebmaster) {
      const routeIds = await getRouteIdsForWebmaster(
        ctx.userId,
        ctx.organizationId,
      );
      if (!routeIds.length) {
        return res.status(200).json({
          success: true,
          data: [],
          meta: { limit: take },
        });
      }
      where.id = { in: routeIds };
    }

    // Keep support for ?userId=... query shape while deriving filter from auth.
    if (req.query.userId !== undefined) {
      where.userId = req.auth.userId;
    }

    if (req.query.name) {
      where.name = { contains: String(req.query.name), mode: "insensitive" };
    }

    if (req.query.product) {
      where.product = { contains: String(req.query.product), mode: "insensitive" };
    }

    if (req.query.hasWebhook !== undefined) {
      if (req.query.hasWebhook !== "true" && req.query.hasWebhook !== "false") {
        return res.status(400).json({
          success: false,
          error: "Invalid hasWebhook filter. Use true or false.",
        });
      }
      where.hasWebhook = req.query.hasWebhook === "true";
    }

    const routes = await prismaClient.route.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
    });

    console.log("[getRoutes] routes: ", routes)
    return res.status(200).json({
      success: true,
      data: routes,
      meta: { limit: take },
    });
  } catch (error) {
    logger.error({ err: error }, "Unable to get routes");
    return res.status(500).json({
      success: false,
      error: "Unable to get routes",
      details: error.message,
    });
  }
};

const addRoute = async (req, res) => {
  try {
    const missingFields = getMissingRequiredFields(req.body);
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
        details: `Required fields: ${missingFields.join(", ")}`,
      });
    }

    const payload = buildRoutePayload(req.body);
    const route = await prismaClient.route.create({
      data: {
        ...payload,
        userId: req.auth.userId,
        organizationId: req.organizationId,
      },
    });

    return res.status(201).json({ success: true, data: route });
  } catch (error) {
    logger.error({ err: error }, "Unable to create route");
    return res.status(500).json({
      error: "Unable to create route",
      details: error.message,
      success: false,
    });
  }
};

const getRouteById = async (req, res) => {
  const { id } = req.params;
  console.log("[getRouteById] id: ", id)
  try {
    const ctx = req.authContext;
    if (ctx?.isWebmaster) {
      const allowed = await getRouteIdsForWebmaster(
        ctx.userId,
        ctx.organizationId,
      );
      if (!allowed.includes(id)) {
        return res.status(404).json({ success: false, error: "Route not found" });
      }
    }

    const route = await prismaClient.route.findFirst({
      where: {
        id,
        organizationId: req.organizationId,
        deletedAt: null,
      },
    });
    if (!route) {
      return res.status(404).json({ success: false, error: "Route not found" });
    }

    return res.status(200).json({ success: true, data: route });
  } catch (error) {
    logger.error({ err: error }, "Unable to get route");
    return res.status(500).json({
      success: false,
      error: "Unable to get route",
      details: error.message,
    });
  }
};

const editRoute = async (req, res) => {
  const { id } = req.params;
  try {
    const missingFields = getMissingRequiredFields(req.body);
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields for PUT update",
        details: `Required fields: ${missingFields.join(", ")}`,
      });
    }

    const existing = await prismaClient.route.findFirst({
      where: { id, organizationId: req.organizationId, deletedAt: null },
    });
    if (!existing) {
      return res.status(404).json({ success: false, error: "Route not found" });
    }

    const payload = buildRoutePayload(req.body);
    const route = await prismaClient.route.update({
      where: { id },
      data: payload,
    });

    return res.status(200).json({ success: true, data: route });
  } catch (error) {
    logger.error({ err: error }, "Unable to update route");
    return res.status(500).json({
      success: false,
      error: "Unable to update route",
      details: error.message,
    });
  }
};

const deleteRouteById = async (req, res) => {
  const { id } = req.params;

  try {
    const existing = await prismaClient.route.findFirst({
      where: { id, organizationId: req.organizationId, deletedAt: null },
    });
    if (!existing) {
      return res.status(404).json({ success: false, error: "Route not found" });
    }

    const response = await prismaClient.route.update({
      where: { id },
      data: {
        deletedAt: new Date(),
      },
    });

    return res.status(200).json({
      success: true,
      data: { id: response.id },
    });
  } catch (error) {
    logger.error({ err: error }, "Error deleting route");
    return res.status(500).json({
      error: "Unable to delete route",
      details: error.message,
    });
  }
};

module.exports = {
  addRoute,
  editRoute,
  getRoutes,
  getRouteById,
  deleteRouteById,
};
