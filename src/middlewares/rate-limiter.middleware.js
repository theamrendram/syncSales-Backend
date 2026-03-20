const rateLimiter = require("express-rate-limit");

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

    return (
      req.body?.apiKey || req.get("x-api-key") || normalizedIp || "anonymous"
    );
  },
});

module.exports = {
  LeadsLimiter,
};
