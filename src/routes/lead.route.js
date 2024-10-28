const {addLead, getLeads, getLeadsByUser} = require("../controllers/leads.controller.js");
const router = require("express").Router();

router.post("/", addLead);
router.get("/", getLeads);
router.get("/user/:userId", getLeadsByUser);

module.exports = router