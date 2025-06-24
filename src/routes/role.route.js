const express = require("express");
const router = express.Router();
const roleController = require("../controllers/role.controller");
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

module.exports = router;
