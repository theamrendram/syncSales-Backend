import { rateLimit } from "express-rate-limit";
import { logLeadOutcome, fingerprintApiKey } from "../utils/leads/lead-log.js";

const getRequestApiKey = (req) => {
  const bodyKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
  const headerKey = req.get("x-api-key");
  const normalizedHeaderKey =
    typeof headerKey === "string" ? headerKey.trim() : "";

  return bodyKey || normalizedHeaderKey || "";
};

const LeadsLimiter = rateLimit({
  windowMs: 10000, // limiter window
  limit: 1, // maximum request
  standardHeaders: "draft-8",
  legacyHeaders: false,
  validate: {
    trustProxy: false,
  },
  // Throttled callers are otherwise invisible: the limiter answers without ever
  // reaching the handler. This reproduces the default response exactly and only
  // adds the log line.
  handler: (req, res, next, options) => {
    logLeadOutcome(req, {
      src: "rate-limit",
      outcome: "rate_limited",
      status: options.statusCode,
      keyFp: fingerprintApiKey(getRequestApiKey(req)) || undefined,
      limit: options.limit,
      windowMs: options.windowMs,
    });
    res.status(options.statusCode).send(options.message);
  },
  keyGenerator: (req) => {
    // Prefer API key on public lead ingestion; fallback to normalized IP.
    const forwardedFor = req.headers["x-forwarded-for"];
    const normalizedIp = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : typeof forwardedFor === "string"
        ? forwardedFor.split(",")[0].trim()
        : req.ip || req.socket?.remoteAddress;

    return getRequestApiKey(req) || normalizedIp || "anonymous";
  },
});

// Per-authenticated-user key; falls back to the client IP.
const userOrIpKey = (req) => {
  const userId = req.auth?.userId || req.authContext?.userId;
  if (userId) return String(userId);

  const forwardedFor = req.headers["x-forwarded-for"];
  const normalizedIp = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : typeof forwardedFor === "string"
      ? forwardedFor.split(",")[0].trim()
      : req.ip || req.socket?.remoteAddress;

  return normalizedIp || "anonymous";
};

// Seconds until the caller's window resets, for the Retry-After header.
const secondsUntilReset = (req, windowMs) => {
  const resetTime = req.rateLimit?.resetTime
    ? new Date(req.rateLimit.resetTime).getTime()
    : null;
  return resetTime != null
    ? Math.max(1, Math.ceil((resetTime - Date.now()) / 1000))
    : Math.ceil(windowMs / 1000);
};

const LeadsDownloadLimiter = rateLimit({
  windowMs: 30_000,
  limit: 1,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  validate: {
    trustProxy: false,
  },
  handler: (req, res, next, options) => {
    const retryAfterSeconds = secondsUntilReset(req, options.windowMs);

    res.setHeader("Retry-After", String(retryAfterSeconds));
    return res.status(options.statusCode).json({
      error: "RATE_LIMITED",
      message: `Too many downloads. Please try again in ${retryAfterSeconds}s.`,
      retryAfterSeconds,
    });
  },
  keyGenerator: userOrIpKey,
});

/**
 * One route test request per user every 10 seconds. Each test makes the server
 * call an arbitrary URL, so this caps how hard one account can drive that.
 * Mounted after body validation, so a rejected payload does not use up the window.
 */
const createWebhookTestLimiter = ({ windowMs = 10_000, limit = 1 } = {}) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    validate: {
      trustProxy: false,
    },
    handler: (req, res, next, options) => {
      const retryAfterSeconds = secondsUntilReset(req, options.windowMs);

      req.log?.info({ retryAfterSeconds }, "Webhook test rate limited");
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(options.statusCode).json({
        error: `You can send one test request every ${Math.round(options.windowMs / 1000)} seconds. Try again in ${retryAfterSeconds}s.`,
        retryAfterSeconds,
      });
    },
    keyGenerator: userOrIpKey,
  });

const WebhookTestLimiter = createWebhookTestLimiter();

export {
  LeadsLimiter,
  LeadsDownloadLimiter,
  WebhookTestLimiter,
  createWebhookTestLimiter,
};
