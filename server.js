import app from "./src/app.js";
import { config, validateEnv } from "./src/config/env.js";
import logger from "./src/utils/logger.js";
import { registerProcessGuards } from "./src/utils/process-guards.js";

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