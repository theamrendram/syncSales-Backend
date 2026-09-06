import { getSellers, addSeller, getSellerById, deleteSeller } from "../controllers/seller.controller.js";
import express from "express";
const router = express.Router;

const route = router();

route.get("/", getSellers);
route.get("/:id", getSellerById);
route.post("/", addSeller);
route.delete("/:id", deleteSeller);

export default route;