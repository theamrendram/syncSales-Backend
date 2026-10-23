import { getSubscription } from "../controllers/subscription.controller.js";

import express from "express";
const router = express.Router();

router.post("/", getSubscription);

export default router;