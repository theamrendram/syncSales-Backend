const {addLead, getLeads, getLeadsByUser, getLeadsByUserPagination, getMonthlyLeadsByUser, getPastTenDaysLeadsByUser} = require("../controllers/leads.controller.js");
const { getChartData } = require("../controllers/chart.controller");
const router = require("express").Router();

router.post("/", addLead);
router.get("/", getLeads);
// router.get("/user/:userId", getLeadsByUser);
router.get("/user/:userId", getMonthlyLeadsByUser);
// router.get("/user/:userId", getPastTenDaysLeadsByUser);
router.get("/chart", getChartData);
router.get("/pagination", getLeadsByUserPagination);

module.exports = router