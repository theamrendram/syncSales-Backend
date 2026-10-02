import { getChartData, getMetricData, getLeadHealth, getSubIdBreakdown } from "../controllers/chart.controller.js";
import { requireOrgPermission } from "../middlewares/authentication-context.middleware.js";
import { Router } from "express";

const router = Router();

router.get("/", requireOrgPermission("lead:read"), getChartData);
router.get("/metric", requireOrgPermission("lead:read"), getMetricData);
router.get("/health", requireOrgPermission("lead:read"), getLeadHealth);
router.get("/subs", requireOrgPermission("lead:read"), getSubIdBreakdown);

export default router;