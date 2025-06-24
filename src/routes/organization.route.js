const express = require("express");
const router = express.Router();
const organizationController = require("../controllers/organization.controller");
// const authMiddleware = require("../middlewares/auth.middleware");

// Apply auth middleware to all routes
// router.use(authMiddleware);

// Organization CRUD operations
router.post("/", organizationController.createOrganization);
router.get("/user", organizationController.getUserOrganizations);
router.get("/:organizationId", organizationController.getOrganization);
router.put("/:organizationId", organizationController.updateOrganization);

// Member management
router.get("/:organizationId/members", organizationController.getMembers);
router.post("/:organizationId/members", organizationController.addMember);
router.delete(
  "/:organizationId/members/:memberId",
  organizationController.removeMember
);

module.exports = router;
