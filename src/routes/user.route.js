const {
  addUser,
  getAllUsers,
  addUserAPI,
  getUserAPI,
} = require("../controllers/user.controller");
const express = require("express");

// Use express.Router() instead of router()
const route = express.Router();

route.post("/", addUser);
route.get("/api", addUserAPI);
route.post("/api", getUserAPI);
route.get("/all", getAllUsers);

module.exports = route;
