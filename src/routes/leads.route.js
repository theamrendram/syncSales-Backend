import { addLead, getLeads, getLeadsByUser, getLeadsByUserPagination, downloadLeadsCsv } from "../controllers/leads.controller.js";
import { getChartData } from "../controllers/chart.controller.js";
import { LeadsDownloadLimiter } from "../middlewares/rate-limiter.middleware.js";
import { requestTiming } from "../utils/request-timer.js";

import express from "express";
const router = express.Router();

router.get("/", getLeads);
router.post("/", requestTiming("POST /lead"), addLead);
router.get("/user", getLeadsByUser);
router.get("/user/pagination", getLeadsByUserPagination);
router.get("/download", LeadsDownloadLimiter, downloadLeadsCsv);
router.get("/chart", getChartData);

export default router;