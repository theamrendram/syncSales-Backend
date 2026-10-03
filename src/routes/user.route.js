import {
  addUser,
  getAllUsers,
  addUserAPI,
  getUserAPI,
  getUser,
} from "../controllers/user.controller.js";
import express from "express";
import accountRoute from "./account.route.js";

// Use express.Router() instead of router()
const route = express.Router();

route.post("/", addUser);
route.get("/", getUser);
route.post("/api-key", addUserAPI);
route.get("/api-key", getUserAPI);
route.use("/account", accountRoute);
// route.get("/all", getAllUsers);

export default route;