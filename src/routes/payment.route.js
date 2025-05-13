const { createSubscription, verifySubscription } = require("../controllers/payment.controller.js");

const router = require("express").Router();

router.post("/subscribe", createSubscription);
router.post("/verify", verifySubscription)

module.exports = router;
