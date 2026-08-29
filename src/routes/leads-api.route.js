const {
  addLead,
  addLeadGet,
  updateLead,
} = require("../controllers/leads-api.controller");
const { LeadsLimiter } = require("../middlewares/rate-limiter.middleware");
const { checkUserPlan } = require("../utils/check-user-plan");
const { requestTiming } = require("../utils/request-timer");
const router = require("express").Router();

// Rate limiting is only enforced in production; elsewhere this is a pass-through.
const leadsRateLimiter =
  process.env.NODE_ENV === "production"
    ? LeadsLimiter
    : (req, res, next) => next();

router.post(
  "/create",
  requestTiming("POST /leads/create"),
  leadsRateLimiter,
  checkUserPlan,
  addLead,
);
router.get(
  "/create",
  requestTiming("GET /leads/create"),
  leadsRateLimiter,
  checkUserPlan,
  addLeadGet,
);
router.put("/update", updateLead);
router.get("/", (req, res) => {
  res.send("GET / Method not allowed");
});

module.exports = router;
