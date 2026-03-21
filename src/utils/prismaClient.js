const { PrismaClient } = require("@prisma/client");

const globalForPrisma = global;

function createPrismaClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

let prismaClient = globalForPrisma.__prismaClient__;

// Dev: avoid a stale singleton from before `prisma generate` (missing new delegates like orgLeadCounter).
if (
  process.env.NODE_ENV !== "production" &&
  prismaClient &&
  typeof prismaClient.orgLeadCounter?.findUnique !== "function"
) {
  prismaClient = null;
}

if (!prismaClient) {
  prismaClient = createPrismaClient();
}

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__prismaClient__ = prismaClient;
}

module.exports = prismaClient;
