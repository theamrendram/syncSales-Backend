const {addPostback} = require("../controllers/postback.controller")
const express = require("express");
const route = express.Router();


route.post("/", addPostback);
route.get("/", addPostback);

module.exports = route;