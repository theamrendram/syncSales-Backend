const {
  addLead,
  addLeadGet,
  updateLead,
} = require("../controllers/leads-api.controller");
const { LeadsLimiter } = require("../middlewares/rate-limiter.middleware");
const { checkUserPlan } = require("../utils/check-user-plan");
const { requestTiming } = require("../utils/request-timer");
const { leadRequestLogger } = require("../utils/lead-log");
const router = require("express").Router();

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

module.exports = router;
