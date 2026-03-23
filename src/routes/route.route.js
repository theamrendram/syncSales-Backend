const {
  addRoute,
  editRoute,
  getRoutes,
  getRouteById,
  deleteRouteById,
} = require("../controllers/route.controller.js");
const express = require("express");

const router = express.Router();

router.post("/", addRoute);
router.get("/", getRoutes);
router.get("/:id", getRouteById);
router.put("/:id", editRoute);
router.delete("/:id", deleteRouteById);

module.exports = router;
