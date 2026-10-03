import express from "express";
import { getAccountSecurity, setPassword, updateProfile } from "../controllers/account.controller.js";

// Mounted under /api/v1/user, so requireAuth() already applies.
const route = express.Router();

route.get("/", getAccountSecurity);
route.put("/password", setPassword);
route.put("/profile", updateProfile);

export default route;
