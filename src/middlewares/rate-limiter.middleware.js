const rateLimiter = require("express-rate-limit");

const LeadsLimiter = rateLimiter.rateLimit({
  windowMs: 10000, // limiter window
  limit: 1, // maximum request
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Prefer API key on public lead ingestion; fallback to IP.
    return (
      req.body?.apiKey ||
      req.get("x-api-key") ||
      req.ip ||
      req.socket?.remoteAddress ||
      "anonymous"
    );
  },
});

module.exports = {
  LeadsLimiter,
};
