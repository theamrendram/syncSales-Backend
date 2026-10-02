import prismaClient from "../utils/prismaClient.js";
import logger from "../utils/logger.js";
import { requireScope } from "../middlewares/scope.middleware.js";

const ROUTE_REQUIRED_FIELDS = ["name", "product", "description", "payout"];

// The webhook fields (url, method, attributes) are deliberately not required:
// a route can be created or updated without a webhook.

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
  ROUTE_REQUIRED_FIELDS.filter((field) => body[field] === undefined);

const getRoutes = async (req, res) => {
  try {
    const take = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const scope = requireScope(req);

    if (scope.empty) {
      return res.status(200).json({
        success: true,
        data: [],
        meta: { limit: take },
      });
    }

    const where = {
      ...scope.where,
      // Soft deletion is a business filter, not an authorization one, so it is
      // added here rather than folded into the scope.
      deletedAt: null,
    };

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
  try {
    const scope = requireScope(req);

    // Out of scope and non-existent give the same answer: a 404 that does not
    // confirm the id is real.
    const route = scope.empty
      ? null
      : await prismaClient.route.findFirst({
          // AND rather than a spread: a webmaster's scope constrains `id`
          // itself, and merging would let it overwrite the id being requested.
          where: { AND: [{ id }, scope.where, { deletedAt: null }] },
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

export { addRoute, editRoute, getRoutes, getRouteById, deleteRouteById };
