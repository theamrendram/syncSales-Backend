import { addRoute, editRoute, getRoutes, getRouteById, deleteRouteById } from "../controllers/route.controller.js";
import express from "express";
import { requireOrgPermission } from "../middlewares/authentication-context.middleware.js";

const router = express.Router();

router.post("/", requireOrgPermission("canEditAllData"), addRoute);
router.get("/", requireOrgPermission("canViewAllData"), getRoutes);
router.get("/:id", requireOrgPermission("canViewAllData"), getRouteById);
router.put("/:id", requireOrgPermission("canEditAllData"), editRoute);
router.delete("/:id", requireOrgPermission("canDeleteData"), deleteRouteById);

export default router;