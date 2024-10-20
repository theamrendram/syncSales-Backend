const {addUser} = require("../controllers/user.controller");
const express = require("express");

// Use express.Router() instead of router()
const route = express.Router();

route.post("/", addUser);

module.exports = route;