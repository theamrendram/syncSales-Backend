import { addRoute, editRoute, getRoutes, getRouteById, deleteRouteById } from "../controllers/route.controller.js";
import express from "express";
import { requireOrgPermission } from "../middlewares/authentication-context.middleware.js";

const router = express.Router();

router.post("/", requireOrgPermission("route:write"), addRoute);
router.get("/", requireOrgPermission("route:read"), getRoutes);
router.get("/:id", requireOrgPermission("route:read"), getRouteById);
router.put("/:id", requireOrgPermission("route:write"), editRoute);
router.delete("/:id", requireOrgPermission("route:delete"), deleteRouteById);

export default router;