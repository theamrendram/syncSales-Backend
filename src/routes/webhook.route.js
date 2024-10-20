const {addWebhook} = require("../controllers/webhook.controller.js");
const router = require("express").Router();

router.post("/", addWebhook);

module.exports = router
