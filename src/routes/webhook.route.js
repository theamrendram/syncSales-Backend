import { addWebhook } from "../controllers/webhook.controller.js";
import express from "express";
const router = express.Router();

router.post("/", addWebhook);

export default router;