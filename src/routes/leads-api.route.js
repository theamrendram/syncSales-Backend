import { addLead, addLeadGet, updateLead } from "../controllers/leads-api.controller.js";
import { LeadsLimiter } from "../middlewares/rate-limiter.middleware.js";
import { checkUserPlan } from "../utils/check-user-plan.js";
import { requestTiming } from "../utils/request-timer.js";
import { leadRequestLogger } from "../utils/lead-log.js";
import express from "express";
const router = express.Router();

// Rate limiting is only enforced in production; elsewhere this is a pass-through.
const leadsRateLimiter =
  process.env.NODE_ENV === "production"
    ? LeadsLimiter
    : (req, res, next) => next();

router.post(
  "/create",
  requestTiming("POST /leads/create"),
  leadRequestLogger("body"),
  leadsRateLimiter,
  checkUserPlan,
  addLead,
);
router.get(
  "/create",
  requestTiming("GET /leads/create"),
  leadRequestLogger("query"),
  leadsRateLimiter,
  checkUserPlan,
  addLeadGet,
);
router.put("/update", updateLead);
router.get("/", (req, res) => {
  res.send("GET / Method not allowed");
});

export default router;