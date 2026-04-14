const express = require("express");
const { handleDodoWebhook } = require("../controllers/dodo.controller");

const router = express.Router();

router.post("/", express.raw({ type: "application/json" }), handleDodoWebhook);

module.exports = router;
