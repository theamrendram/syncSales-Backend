const {
  addLead,
  addLeadGet,
  updateLead,
} = require("../controllers/leads-api.controller");
const { LeadsLimiter } = require("../middlewares/rate-limiter.middleware");
const router = require("express").Router();

router.post("/create", LeadsLimiter, addLead);
router.get("/create", addLeadGet);
router.put("/update", updateLead);
router.get("/", (req, res) => {
  res.send("GET / Method not allowed");
});

module.exports = router;
