const express = require("express");
const {
  createDodoCheckoutSession,
  createDodoPortalSession,
} = require("../controllers/dodo.controller");

const router = express.Router();

router.post("/checkout-session", createDodoCheckoutSession);
router.post("/portal-session", createDodoPortalSession);

module.exports = router;
