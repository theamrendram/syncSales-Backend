import { createSubscription, verifySubscription } from "../controllers/payment.controller.js";

import express from "express";
const router = express.Router();

router.post("/subscribe", createSubscription);
router.post("/verify", verifySubscription)

export default router;