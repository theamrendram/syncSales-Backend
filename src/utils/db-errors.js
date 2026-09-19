// Detects "database unreachable" so the lead path can answer 503 + Retry-After.
// Lead senders (Meta, Zapier, Make) retry on 503 but give up on 500.

// Prisma: can't reach, timed out, operation timed out, connection closed, pool timeout.
const UNAVAILABLE_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024"]);

const UNAVAILABLE_MESSAGE =
  /can't reach database server|connection timed out|timed out fetching a new connection|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ENOTFOUND|server has closed the connection/i;

const isDatabaseUnavailable = (err) => {
  if (!err) return false;
  if (err.code && UNAVAILABLE_CODES.has(err.code)) return true;
  // First connection never established.
  if (err.name === "PrismaClientInitializationError") return true;
  return typeof err.message === "string" && UNAVAILABLE_MESSAGE.test(err.message);
};

const retryAfterSeconds = () => {
  const parsed = Number(process.env.DB_UNAVAILABLE_RETRY_AFTER_SECONDS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 60;
};

// request_id points at the lead_request log line, which holds the payload.
const sendDatabaseUnavailable = (req, res) => {
  const seconds = retryAfterSeconds();
  res.setHeader("Retry-After", String(seconds));
  return res.status(503).json({
    success: false,
    error: `Service temporarily unavailable. Retry after ${seconds} seconds.`,
    retryAfterSeconds: seconds,
    request_id: req?.id,
  });
};

module.exports = { isDatabaseUnavailable, sendDatabaseUnavailable, retryAfterSeconds };
