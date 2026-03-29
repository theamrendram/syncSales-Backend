const {
  addRoute,
  editRoute,
  getRoutes,
  getRouteById,
  deleteRouteById,
} = require("../controllers/route.controller.js");
const express = require("express");
const {
  requireOrgPermission,
} = require("../middlewares/authentication-context.middleware");

const router = express.Router();

router.post("/", requireOrgPermission("canEditAllData"), addRoute);
router.get("/", requireOrgPermission("canViewAllData"), getRoutes);
router.get("/:id", requireOrgPermission("canViewAllData"), getRouteById);
router.put("/:id", requireOrgPermission("canEditAllData"), editRoute);
router.delete("/:id", requireOrgPermission("canDeleteData"), deleteRouteById);

module.exports = router;
