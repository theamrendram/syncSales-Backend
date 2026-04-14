const express = require("express");
const {
  createDodoCheckoutSession,
  getDodoHealth,
} = require("../controllers/dodo.controller");

const router = express.Router();

router.get("/health", getDodoHealth);
router.post("/checkout-session", createDodoCheckoutSession);

module.exports = router;
