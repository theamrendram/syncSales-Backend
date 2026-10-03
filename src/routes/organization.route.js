import { requireOrgPermission } from "../middlewares/authentication-context.middleware.js";
import express from "express";
import multer from "multer";
import path from "path";
const router = express.Router();

import { createOrganization, getUserOrganizations, getOrganization, updateOrganization, getMembers, addMember, removeMember, updateMemberAuthSettings, getCurrentOrganization, updateMemberRole } from "../controllers/organization.controller.js";

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
// Before "/:organizationId" so "current" is not read as an id.
router.get("/current", getCurrentOrganization);
router.get("/:organizationId", getOrganization);
router.put("/:organizationId", requireOrgPermission("organization:manage"), updateOrganization);
// Owner-only; the controller checks isOrganizationOwner directly so the rule
// does not drift if organization:manage is ever granted to another role.
router.put("/:organizationId/auth-settings", updateMemberAuthSettings);

// Member management
router.get("/:organizationId/members", requireOrgPermission("member:manage"), getMembers);
router.patch("/:organizationId/members/:memberId", requireOrgPermission("member:manage"), updateMemberRole);
router.post("/:organizationId/members", requireOrgPermission("member:manage"), addMember);
router.delete("/:organizationId/members/:memberId", requireOrgPermission("member:manage"), removeMember);

export default router;