const {addLead, getLeads, getLeadsByUser, getChartData, getLeadsByUserPagination, getMonthlyLeadsByUser, getPastTenDaysLeadsByUser} = require("../controllers/leads.controller.js");
const router = require("express").Router();

router.post("/", addLead);
router.get("/", getLeads);
// router.get("/user/:userId", getLeadsByUser);
router.get("/user/:userId", getMonthlyLeadsByUser);
// router.get("/user/:userId", getPastTenDaysLeadsByUser);
router.get("/chart", getChartData);
router.get("/pagination", getLeadsByUserPagination);

module.exports = router