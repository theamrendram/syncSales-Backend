const {
  getCampaigns,
  getCampaignById,
  addCampaign,
  editCampaign,
  deleteCampaign,
} = require("../controllers/campaign.controller.js");
const router = require("express").Router();
const {
  requireOrgPermission,
} = require("../middlewares/authentication-context.middleware");

router.get("/", requireOrgPermission("canViewAllData"), getCampaigns);
router.get("/:id", requireOrgPermission("canViewAllData"), getCampaignById);
router.post("/", requireOrgPermission("canEditAllData"), addCampaign);
router.put("/:id", requireOrgPermission("canEditAllData"), editCampaign);
router.delete("/:id", requireOrgPermission("canDeleteData"), deleteCampaign);

module.exports = router;
