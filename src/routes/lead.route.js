const {addLead, getLeads, getLeadsByUser, getChartData} = require("../controllers/leads.controller.js");
const router = require("express").Router();

router.post("/", addLead);
router.get("/", getLeads);
router.get("/user/:userId", getLeadsByUser);
router.get("/chart", getChartData);

module.exports = router