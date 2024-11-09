const {
  getCampaigns,
  getCampaignById,
  getCampaignsByUser,
  addCampaign,
  editCampaign,
  deleteCampaign
} = require("../controllers/campaign.controller.js");
const router = require("express").Router();

router.get("/all", getCampaigns);
router.get("/user/:userId", getCampaignsByUser);
router.get("/:id", getCampaignById);
router.post("/", addCampaign);
router.put("/edit/:id", editCampaign);
router.delete("/:id", deleteCampaign);

module.exports = router;
