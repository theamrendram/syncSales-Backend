const logger = require("./logger");
const prismaClient = require("./prismaClient");

let handlersRegistered = false;

function registerProcessGuards() {
  if (handlersRegistered) return;

  process.on("uncaughtException", (error) => {
    logger.fatal({ err: error }, "Uncaught exception");
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "Unhandled promise rejection");
  });

  process.on("SIGTERM", async () => {
    logger.info("SIGTERM received, shutting down");
    await prismaClient.$disconnect();
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    logger.info("SIGINT received, shutting down");
    await prismaClient.$disconnect();
    process.exit(0);
  });

  handlersRegistered = true;
}

module.exports = {
  registerProcessGuards,
};
