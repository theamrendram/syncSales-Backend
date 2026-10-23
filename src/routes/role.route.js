import { requireOrgPermission } from "../middlewares/authentication-context.middleware.js";
import express from "express";
const router = express.Router();
import * as roleController from "../controllers/role.controller.js";
// const authMiddleware = require("../middlewares/auth.middleware");

// Apply auth middleware to all routes
// router.use(authMiddleware);

// Role CRUD operations
router.post("/:organizationId/roles", requireOrgPermission("role:manage"), roleController.createRole);
router.get("/:organizationId/roles", roleController.getRoles);
router.put("/:organizationId/roles/:roleId", requireOrgPermission("role:manage"), roleController.updateRole);
router.delete("/:organizationId/roles/:roleId", requireOrgPermission("role:manage"), roleController.deleteRole);

// Member role management
router.put(
  "/:organizationId/members/:memberId/role",
  requireOrgPermission("member:manage"),
  roleController.updateMemberRole
);

export default router;