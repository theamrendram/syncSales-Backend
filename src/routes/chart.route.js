import { getChartData, getMetricData, getLeadHealth, getSubIdBreakdown } from "../controllers/chart.controller.js";
import { Router } from "express";

const router = Router();

router.get("/", getChartData);
router.get("/metric", getMetricData);
router.get("/health", getLeadHealth);
router.get("/subs", getSubIdBreakdown);

export default router;