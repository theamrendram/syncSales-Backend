const pino = require("pino");
const { errSerializer } = require("./log-serializers");

const isProduction = process.env.NODE_ENV === "production";

const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  // Logs ship to a hosted store that cannot be redacted after the fact, so
  // credentials and customer contact details are stripped before they are
  // written. Bare "email" is deliberately not redacted: the Clerk webhook flow
  // logs it as its only identifier.
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers['x-api-key']",
      "req.body.password",
      "req.body.apiKey",
      "req.body.customer",
      "req.query.apiKey",
      "apiKey",
      "*.apiKey",
      "phone",
      "*.phone",
      "*.email",
      "razorpaySignature",
    ],
    remove: true,
  },
  serializers: {
    err: errSerializer,
  },
  base: undefined,
});

module.exports = logger;
