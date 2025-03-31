const { addLead, addLeadGet, updateLead } = require("../controllers/leads-api.controller");

const router = require("express").Router();

router.post("/create", addLead);
router.get("/create", addLeadGet);
router.put("/update", updateLead);

router.get("/", (req, res) => {
  res.send("GET / Method not allowed");
});

module.exports = router;
