const app = require("./src/app");
const { config, validateEnv } = require("./src/config/env");
const logger = require("./src/utils/logger");
const { registerProcessGuards } = require("./src/utils/process-guards");

validateEnv();
registerProcessGuards();

if (config.memoryMonitorEnabled) {
  const memoryMonitor = setInterval(() => {
    const used = process.memoryUsage();
    logger.info(
      {
        rssMB: Math.round(used.rss / 1024 / 1024),
        heapUsedMB: Math.round(used.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(used.heapTotal / 1024 / 1024),
        externalMB: Math.round(used.external / 1024 / 1024),
      },
      "Memory usage"
    );
  }, config.memoryMonitorIntervalMs);

  memoryMonitor.unref();
}

app.listen(config.port, () => {
  logger.info({ port: config.port }, "Server is running");
});