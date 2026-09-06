import express from "express";
import multer from "multer";
import path from "path";
const router = express.Router();

import { createOrganization, getUserOrganizations, getOrganization, updateOrganization, getMembers, addMember, removeMember } from "../controllers/organization.controller.js";

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only images allowed!"), false);
    }
  },
});

// Organization CRUD
router.post("/", createOrganization);
router.get("/user", getUserOrganizations);
router.get("/:organizationId", getOrganization);
router.put("/:organizationId", updateOrganization);

// Member management
router.get("/:organizationId/members", getMembers);
router.post("/:organizationId/members", addMember);
router.delete("/:organizationId/members/:memberId", removeMember);

export default router;