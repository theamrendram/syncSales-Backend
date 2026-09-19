const rateLimiter = require("express-rate-limit");
const { logLeadOutcome, fingerprintApiKey } = require("../utils/lead-log");

const getRequestApiKey = (req) => {
  const bodyKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
  const headerKey = req.get("x-api-key");
  const normalizedHeaderKey =
    typeof headerKey === "string" ? headerKey.trim() : "";

  return bodyKey || normalizedHeaderKey || "";
};

// Every 429 here is a delivered lead we did not store. The old 1-per-10s limit
// rejected real leads in normal traffic (21 of 109 on 16-19 Sep 2026). Double
// submits are caught by the duplicate check, so this only needs to stop floods.
const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const createLeadsLimiter = ({
  limit = parsePositiveInt(process.env.LEADS_RATE_LIMIT, 60),
  windowMs = parsePositiveInt(process.env.LEADS_RATE_WINDOW_MS, 60_000),
} = {}) =>
  rateLimiter.rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    validate: {
      trustProxy: false,
    },
    // The limiter answers before the handler, so log the outcome here. The
    // payload is on the lead_request line with the same reqId.
    handler: (req, res, next, options) => {
      logLeadOutcome(req, {
        src: "rate-limit",
        outcome: "rate_limited",
        status: options.statusCode,
        keyFp: fingerprintApiKey(getRequestApiKey(req)) || undefined,
        limit: options.limit,
        windowMs: options.windowMs,
      });
      res.status(options.statusCode).json({
        error: "Too many requests, please try again later.",
        retryAfterSeconds: Math.ceil(options.windowMs / 1000),
      });
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

const LeadsLimiter = createLeadsLimiter();

const LeadsDownloadLimiter = rateLimiter.rateLimit({
  windowMs: 30_000,
  limit: 1,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  validate: {
    trustProxy: false,
  },
  handler: (req, res, next, options) => {
    const resetTime = req.rateLimit?.resetTime
      ? new Date(req.rateLimit.resetTime).getTime()
      : null;
    const now = Date.now();
    const retryAfterSeconds =
      resetTime != null ? Math.max(1, Math.ceil((resetTime - now) / 1000)) : 30;

    res.setHeader("Retry-After", String(retryAfterSeconds));
    return res.status(options.statusCode).json({
      error: "RATE_LIMITED",
      message: `Too many downloads. Please try again in ${retryAfterSeconds}s.`,
      retryAfterSeconds,
    });
  },
  keyGenerator: (req) => {
    // Per-authenticated-user rate limiting for downloads; fallback to IP.
    const userId = req.auth?.userId || req.authContext?.userId;
    if (userId) return String(userId);

    const forwardedFor = req.headers["x-forwarded-for"];
    const normalizedIp = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : typeof forwardedFor === "string"
        ? forwardedFor.split(",")[0].trim()
        : req.ip || req.socket?.remoteAddress;

    return normalizedIp || "anonymous";
  },
});

module.exports = {
  LeadsLimiter,
  LeadsDownloadLimiter,
  createLeadsLimiter,
};
