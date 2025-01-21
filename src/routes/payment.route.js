const { createSubscription, paymentVerification } = require("../controllers/payment.controller.js");

const router = require("express").Router();

router.post("/subscribe", createSubscription);
router.post("/verify", paymentVerification)

module.exports = router;
