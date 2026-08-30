const {
  getChartData,
  getMetricData,
  getLeadHealth,
  getSubIdBreakdown,
  getRoutePerformance,
} = require("../controllers/chart.controller");
const { Router } = require("express");

const router = Router();

router.get("/", getChartData);
router.get("/metric", getMetricData);
router.get("/health", getLeadHealth);
router.get("/subs", getSubIdBreakdown);
// `:routeId` is the route's uuid (`Route.id`), not the display number.
router.get("/route/:routeId/series", getRoutePerformance);

module.exports = router;
