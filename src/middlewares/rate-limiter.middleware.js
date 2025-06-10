const rateLimiter = require("express-rate-limit");

const LeadsLimiter = rateLimiter.rateLimit({
  windowMs: 2000, // limiter window
  limit: 1, // maximum request
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

module.exports = {
  LeadsLimiter,
};
