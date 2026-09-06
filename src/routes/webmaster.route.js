import { addWebmaster, getWebmasters, getWebmasterById, updateWebmaster, deleteWebmaster } from "../controllers/webmaster.controller.js";

import express from "express";
const router = express.Router();

router.post("/", addWebmaster);
router.get("/", getWebmasters);
router.get("/:id", getWebmasterById);
router.put("/:id", updateWebmaster);
router.delete("/:id", deleteWebmaster);

export default router;