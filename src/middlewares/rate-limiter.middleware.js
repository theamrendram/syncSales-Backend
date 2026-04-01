const rateLimiter = require("express-rate-limit");

const getRequestApiKey = (req) => {
  const bodyKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
  const headerKey = req.get("x-api-key");
  const normalizedHeaderKey =
    typeof headerKey === "string" ? headerKey.trim() : "";

  return bodyKey || normalizedHeaderKey || "";
};

const LeadsLimiter = rateLimiter.rateLimit({
  windowMs: 10000, // limiter window
  limit: 1, // maximum request
  standardHeaders: "draft-8",
  legacyHeaders: false,
  validate: {
    trustProxy: false,
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
};
