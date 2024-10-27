const {
  getSellers,
  addSeller,
} = require("../controllers/seller.controller.js");
const router = require("express").Router;

const route = router();

route.get("/", getSellers);
route.post("/", addSeller);

module.exports = route;
