import { createRequire } from "node:module";
import pino from "pino";
import { errSerializer } from "./log-serializers.js";

const isProduction = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test";

/**
 * Human-readable log output for local development.
 *
 * Production ships JSON: the hosted log store parses it, and a transport there
 * would only cost a worker thread. Tests stay on JSON too - a transport keeps
 * a worker alive past the last assertion, which leaves vitest hanging.
 *
 * pino-pretty is a devDependency, so a production install does not have it.
 * Resolving it before naming it as a target means a deployment that forgets to
 * set NODE_ENV degrades to JSON instead of crashing on boot.
 */
function prettyTransport() {
  if (isProduction || isTest) return undefined;

  try {
    createRequire(import.meta.url).resolve("pino-pretty");
  } catch {
    return undefined;
  }

  return {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:HH:MM:ss.l",
      // `base: undefined` below already drops pid and hostname; this covers the
      // reqId that pino-http stamps on every line, which is noise when the
      // requests are arriving one at a time in front of you.
      ignore: "pid,hostname,reqId",
      // Keeps the req/res and err objects on the message line rather than
      // spilling a multi-line block for every request.
      singleLine: true,
    },
  };
}

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
      // Top-level "apiKey" is deliberately absent: the lead_request event
      // prints the caller's key so a lead can be replayed from the logs alone.
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
  transport: prettyTransport(),
});

export default logger;