import express from "express";
const router = express.Router();
import { handleClerkWebhook } from "../controllers/clerk-webhook.controller.js";

router.post("/", express.raw({ type: "application/json" }), handleClerkWebhook);
router.get("/", async (req, res) => {
  res.status(200).json({ message: "Webhook received" });
});

export default router;