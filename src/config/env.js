function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  return value === "true";
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function validateEnv() {
  const required = ["DATABASE_URL", "DODO_PAYMENTS_API_KEY", "DODO_PAYMENTS_WEBHOOK_SECRET"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

const config = {
  isProduction: process.env.NODE_ENV === "production",
  port: parseNumber(process.env.PORT, 8000),
  requestLimit: process.env.REQUEST_SIZE_LIMIT || "1mb",
  memoryMonitorEnabled: parseBoolean(process.env.MEMORY_MONITOR_ENABLED, true),
  memoryMonitorIntervalMs: parseNumber(
    process.env.MEMORY_MONITOR_INTERVAL_MS,
    600000 // 10 minutes
  ),
};

module.exports = {
  config,
  validateEnv,
};
