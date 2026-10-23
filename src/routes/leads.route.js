import { addLead, getLeads, updateLeadStatus, getLeadsByUser, getLeadsByUserPagination, downloadLeadsCsv } from "../controllers/leads.controller.js";
import { getChartData } from "../controllers/chart.controller.js";
import { LeadsDownloadLimiter } from "../middlewares/rate-limiter.middleware.js";
import { requestTiming } from "../utils/http/request-timer.js";

import { requireOrgPermission } from "../middlewares/authentication-context.middleware.js";
import express from "express";
const router = express.Router();

router.get("/", requireOrgPermission("lead:read"), getLeads);
router.post("/", requireOrgPermission("lead:write"), requestTiming("POST /lead"), addLead);
router.get("/user", requireOrgPermission("lead:read"), getLeadsByUser);
router.get("/user/pagination", requireOrgPermission("lead:read"), getLeadsByUserPagination);
router.get("/download", requireOrgPermission("lead:read"), LeadsDownloadLimiter, downloadLeadsCsv);
router.patch("/:id/status", requireOrgPermission("lead:write"), updateLeadStatus);
router.get("/chart", requireOrgPermission("lead:read"), getChartData);

export default router;