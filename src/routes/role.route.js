import express from "express";
const router = express.Router();
import * as roleController from "../controllers/role.controller.js";
// const authMiddleware = require("../middlewares/auth.middleware");

// Apply auth middleware to all routes
// router.use(authMiddleware);

// Role CRUD operations
router.post("/:organizationId/roles", roleController.createRole);
router.get("/:organizationId/roles", roleController.getRoles);
router.put("/:organizationId/roles/:roleId", roleController.updateRole);
router.delete("/:organizationId/roles/:roleId", roleController.deleteRole);

// Member role management
router.put(
  "/:organizationId/members/:memberId/role",
  roleController.updateMemberRole
);

export default router;