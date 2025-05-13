const {getSubscription} = require("../controllers/subscription.controller.js");

const router = require("express").Router();

router.post("/", getSubscription);

module.exports = router