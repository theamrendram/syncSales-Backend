const { getChartData, getMetricData } = require("../controllers/chart.controller");
const { Router } = require("express");

const router = Router();

router.get("/", getChartData);
router.get("/metric", getMetricData);

module.exports = router;