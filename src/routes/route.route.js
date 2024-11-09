const {
  addRoute,
  editRoute,
  getRoutes,
  getRouteById,
  getRouteByUser,
  deleteRouteById,
} = require("../controllers/route.controller.js");
const express = require("express");

// Use express.Router() instead of router()
const route = express.Router();

route.post("/", addRoute);
route.get("/", getRoutes);
route.get("/:id", getRouteById);
route.delete("/:id", deleteRouteById);
route.put("/edit/:id", editRoute);
route.get("/user/:userId", getRouteByUser);

module.exports = route;
