import { addPostback } from "../controllers/postback.controller.js";
import express from "express";
const route = express.Router();


route.post("/", addPostback);
route.get("/", addPostback);
route.put("/", addPostback);

export default route;