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

module.exports = {
  LeadsLimiter,
};
