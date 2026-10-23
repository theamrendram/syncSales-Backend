import { getCampaigns, getCampaignById, addCampaign, editCampaign, deleteCampaign } from "../controllers/campaign.controller.js";
import express from "express";
const router = express.Router();
import { requireOrgPermission } from "../middlewares/authentication-context.middleware.js";

router.get("/", requireOrgPermission("campaign:read"), getCampaigns);
router.get("/:id", requireOrgPermission("campaign:read"), getCampaignById);
router.post("/", requireOrgPermission("campaign:write"), addCampaign);
router.put("/:id", requireOrgPermission("campaign:write"), editCampaign);
router.delete("/:id", requireOrgPermission("campaign:delete"), deleteCampaign);

export default router;