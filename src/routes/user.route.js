const {addUser, getAllUsers} = require("../controllers/user.controller");
const express = require("express");

// Use express.Router() instead of router()
const route = express.Router();

route.post("/", addUser);
route.get("/all", getAllUsers);

module.exports = route;