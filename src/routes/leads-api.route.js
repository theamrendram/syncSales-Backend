const { addLead, addLeadGet } = require("../controllers/leads.api.controller");

const router = require("express").Router();

router.post("/", addLead);
router.get("/", addLeadGet);

module.exports = router;
