const {
  getSellers,
  addSeller,
  getSellerById,
  deleteSeller
} = require("../controllers/seller.controller.js");
const router = require("express").Router;

const route = router();

route.get("/", getSellers);
route.get("/:id", getSellerById);
route.post("/", addSeller);
route.delete("/:id", deleteSeller);

module.exports = route;
