import { addRoute, editRoute, getRoutes, getRouteById, deleteRouteById } from "../controllers/route.controller.js";
import { testWebhook, validateWebhookTest } from "../controllers/route-test.controller.js";
import express from "express";
import { requireOrgPermission } from "../middlewares/authentication-context.middleware.js";
import { WebhookTestLimiter } from "../middlewares/rate-limiter.middleware.js";

const router = express.Router();

router.post("/", requireOrgPermission("route:write"), addRoute);
// Validation runs before the limiter so a rejected payload does not use up the window.
router.post(
  "/test-webhook",
  requireOrgPermission("route:write"),
  validateWebhookTest,
  WebhookTestLimiter,
  testWebhook,
);
router.get("/", requireOrgPermission("route:read"), getRoutes);
router.get("/:id", requireOrgPermission("route:read"), getRouteById);
router.put("/:id", requireOrgPermission("route:write"), editRoute);
router.delete("/:id", requireOrgPermission("route:delete"), deleteRouteById);

export default router;
