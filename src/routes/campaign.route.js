const {
  getCampaigns,
  getCampaignById,
  addCampaign,
  editCampaign,
  deleteCampaign
} = require("../controllers/campaign.controller.js");
const router = require("express").Router();

router.get("/", getCampaigns);
router.get("/:id", getCampaignById);
router.post("/", addCampaign);
router.put("/edit/:id", editCampaign);
router.delete("/:id", deleteCampaign);

module.exports = router;
