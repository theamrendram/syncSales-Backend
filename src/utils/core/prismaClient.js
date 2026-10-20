import { PrismaClient } from "@prisma/client";
import logger from "./logger.js";
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

/**
 * checks the database connection by attempting to connect to the database and logging the result.
 * @async
 * @function verifyDatabaseConnection
 * @returns 
 */

export async function verifyDatabaseConnection() {
  const startedAt = Date.now();
  try {
    await prismaClient.$queryRaw`SELECT 1`;
    logger.info({ ms: Date.now() - startedAt }, "Database connection verified");
    return true;
  } catch (err) {
    logger.error({ err }, "Database connection verification failed");
    return false;
  }

}

export default prismaClient;