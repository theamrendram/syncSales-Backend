const {addLead, getLeads, getLeadsByUser, getChartData, getLeadsByUserPagination} = require("../controllers/leads.controller.js");
const router = require("express").Router();

router.post("/", addLead);
router.get("/", getLeads);
router.get("/user/:userId", getLeadsByUser);
router.get("/chart", getChartData);
router.get("/pagination", getLeadsByUserPagination);

module.exports = router