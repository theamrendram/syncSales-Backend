const express = require("express");
const router = express.Router();
const {
  handleClerkWebhook,
} = require("../controllers/clerk-webhook.controller");

router.post("/", express.raw({ type: "application/json" }), handleClerkWebhook);
router.get("/", async (req, res) => {
  res.status(200).json({ message: "Webhook received" });
});

module.exports = router;
