const {
  addLead,
  getLeads,
  getLeadsByUser,
  getLeadsByUserPagination,
  getMonthlyLeadsByUser,
  getPastTenDaysLeadsByUser,
} = require("../controllers/leads.controller.js");
const { getChartData } = require("../controllers/chart.controller");

const router = require("express").Router();

router.get("/", getLeads);
router.post("/", addLead);
router.get("/user", getLeadsByUser);
router.get("/user/monthly", getMonthlyLeadsByUser);
router.get("/user/past-ten-days", getPastTenDaysLeadsByUser);
router.get("/user/:userId", getMonthlyLeadsByUser);
router.get("/pagination", getLeadsByUserPagination);
router.get("/chart", getChartData);

module.exports = router;