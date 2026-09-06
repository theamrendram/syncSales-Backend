import { getCampaigns, getCampaignById, addCampaign, editCampaign, deleteCampaign } from "../controllers/campaign.controller.js";
import express from "express";
const router = express.Router();
import { requireOrgPermission } from "../middlewares/authentication-context.middleware.js";

router.get("/", requireOrgPermission("canViewAllData"), getCampaigns);
router.get("/:id", requireOrgPermission("canViewAllData"), getCampaignById);
router.post("/", requireOrgPermission("canEditAllData"), addCampaign);
router.put("/:id", requireOrgPermission("canEditAllData"), editCampaign);
router.delete("/:id", requireOrgPermission("canDeleteData"), deleteCampaign);

export default router;