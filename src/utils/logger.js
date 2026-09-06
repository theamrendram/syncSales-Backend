import pino from "pino";
import { errSerializer } from "./log-serializers.js";

const isProduction = process.env.NODE_ENV === "production";

const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  // Logs ship to a hosted store that cannot be redacted after the fact, so
  // credentials are stripped before they are written.
  //
  // Contact details are NOT blanket-redacted: the lead_request event logs the
  // inbound payload deliberately, and a "*.phone"/"*.email" rule would empty it
  // without saying so. Accidental leaks are held off at the source instead -
  // errSerializer drops the axios request/response bodies, and the webhook
  // event logs only the downstream id and verdict.
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
      "*.*.apiKey",
      "razorpaySignature",
    ],
    remove: true,
  },
  serializers: {
    err: errSerializer,
  },
  base: undefined,
});

export default logger;