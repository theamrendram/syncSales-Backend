const {
  addLead,
  addLeadGet,
  updateLead,
} = require("../controllers/leads-api.controller");
const { LeadsLimiter } = require("../middlewares/rate-limiter.middleware");
const { checkUserPlan } = require("../utils/check-user-plan");
const router = require("express").Router();

router.post("/create", checkUserPlan, LeadsLimiter, addLead);
router.get("/create", checkUserPlan, LeadsLimiter, addLeadGet);
router.put("/update", updateLead);
router.get("/", (req, res) => {
  res.send("GET / Method not allowed");
});

module.exports = router;
