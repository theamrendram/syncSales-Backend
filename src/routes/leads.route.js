const {
  addLead,
  getLeads,
  getLeadsByUser,
  getLeadsByUserPagination,
  downloadLeadsCsv,
} = require("../controllers/leads.controller.js");
const { getChartData } = require("../controllers/chart.controller");
const { LeadsDownloadLimiter } = require("../middlewares/rate-limiter.middleware");

const router = require("express").Router();

router.get("/", getLeads);
router.post("/", addLead);
router.get("/user", getLeadsByUser);
router.get("/user/pagination", getLeadsByUserPagination);
router.get("/download", LeadsDownloadLimiter, downloadLeadsCsv);
router.get("/chart", getChartData);

module.exports = router;
