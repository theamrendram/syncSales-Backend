-- DropForeignKey
ALTER TABLE "Campaign" DROP CONSTRAINT "Campaign_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "Lead" DROP CONSTRAINT "Lead_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "Route" DROP CONSTRAINT "Route_organizationId_fkey";

-- DropIndex
DROP INDEX "AccessControl_userId_campaignId_key";

-- DropIndex
DROP INDEX "AccessControl_userId_organizationId_campaignId_idx";

-- DropIndex
DROP INDEX "AccessControl_userId_organizationId_routeId_idx";

-- DropIndex
DROP INDEX "AccessControl_userId_routeId_campaignId_key";

-- DropIndex
DROP INDEX "AccessControl_userId_routeId_key";

-- DropIndex
DROP INDEX "Campaign_organizationId_routeId_idx";

-- DropIndex
DROP INDEX "Lead_organizationId_userId_idx";

-- DropIndex
DROP INDEX "Route_organizationId_userId_idx";

-- AlterTable
ALTER TABLE "Campaign" ALTER COLUMN "organizationId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Lead" ALTER COLUMN "organizationId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Route" ALTER COLUMN "organizationId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "apiKey" SET DEFAULT '0';

-- CreateIndex
CREATE INDEX "AccessControl_routeId_idx" ON "AccessControl"("routeId");

-- CreateIndex
CREATE INDEX "AccessControl_campaignId_idx" ON "AccessControl"("campaignId");

-- CreateIndex
CREATE INDEX "AccessControl_userId_routeId_idx" ON "AccessControl"("userId", "routeId");

-- CreateIndex
CREATE INDEX "AccessControl_userId_campaignId_idx" ON "AccessControl"("userId", "campaignId");

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
