const { PrismaClient } = require("@prisma/client");

const globalForPrisma = global;

const prismaClient =
  globalForPrisma.__prismaClient__ ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__prismaClient__ = prismaClient;
}

module.exports = prismaClient;
