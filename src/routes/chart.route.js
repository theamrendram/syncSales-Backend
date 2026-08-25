const {
  getChartData,
  getMetricData,
  getLeadHealth,
  getSubIdBreakdown,
} = require("../controllers/chart.controller");
const { Router } = require("express");

const router = Router();

router.get("/", getChartData);
router.get("/metric", getMetricData);
router.get("/health", getLeadHealth);
router.get("/subs", getSubIdBreakdown);

module.exports = router;
