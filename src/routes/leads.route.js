const {
  addLead,
  getLeads,
  getLeadsByUser,
  getLeadsByUserPagination,
} = require("../controllers/leads.controller.js");
const { getChartData } = require("../controllers/chart.controller");

const router = require("express").Router();

router.get("/", getLeads);
router.post("/", addLead);
router.get("/user", getLeadsByUser);
router.get("/user/pagination", getLeadsByUserPagination);
router.get("/chart", getChartData);

module.exports = router;
