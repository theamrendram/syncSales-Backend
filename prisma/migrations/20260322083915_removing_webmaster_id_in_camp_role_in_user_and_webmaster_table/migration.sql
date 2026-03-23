/*
  Warnings:

  - You are about to drop the column `webmasterId` on the `Campaign` table. All the data in the column will be lost.
  - You are about to drop the column `role` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `Webmaster` table. If the table is not empty, all the data it contains will be lost.
  - Made the column `organizationId` on table `Campaign` required. This step will fail if there are existing NULL values in that column.
  - Made the column `organizationId` on table `Lead` required. This step will fail if there are existing NULL values in that column.
  - Made the column `organizationId` on table `Route` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "public"."AccessType" AS ENUM ('view');

-- DropForeignKey
ALTER TABLE "public"."Campaign" DROP CONSTRAINT "Campaign_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Campaign" DROP CONSTRAINT "Campaign_webmasterId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Lead" DROP CONSTRAINT "Lead_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Route" DROP CONSTRAINT "Route_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Webmaster" DROP CONSTRAINT "Webmaster_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Webmaster" DROP CONSTRAINT "Webmaster_userId_fkey";

-- AlterTable
ALTER TABLE "public"."Campaign" DROP COLUMN "webmasterId",
ADD COLUMN     "webmasterUserId" TEXT,
ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."Lead" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."Route" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."User" DROP COLUMN "role",
ALTER COLUMN "apiKey" DROP DEFAULT;

-- DropTable
DROP TABLE "public"."Webmaster";

-- CreateTable
CREATE TABLE "public"."WebmasterProfile" (
    "userId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "leadLimit" INTEGER,
    "payout" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebmasterProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "public"."AccessControl" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "routeId" TEXT,
    "campaignId" TEXT,
    "accessType" "public"."AccessType" NOT NULL DEFAULT 'view',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessControl_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebmasterProfile_isActive_idx" ON "public"."WebmasterProfile"("isActive");

-- CreateIndex
CREATE INDEX "AccessControl_organizationId_idx" ON "public"."AccessControl"("organizationId");

-- CreateIndex
CREATE INDEX "AccessControl_userId_organizationId_idx" ON "public"."AccessControl"("userId", "organizationId");

-- CreateIndex
CREATE INDEX "AccessControl_userId_organizationId_routeId_idx" ON "public"."AccessControl"("userId", "organizationId", "routeId");

-- CreateIndex
CREATE INDEX "AccessControl_userId_organizationId_campaignId_idx" ON "public"."AccessControl"("userId", "organizationId", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "AccessControl_userId_routeId_key" ON "public"."AccessControl"("userId", "routeId");

-- CreateIndex
CREATE UNIQUE INDEX "AccessControl_userId_campaignId_key" ON "public"."AccessControl"("userId", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "AccessControl_userId_routeId_campaignId_key" ON "public"."AccessControl"("userId", "routeId", "campaignId");

-- CreateIndex
CREATE INDEX "Campaign_webmasterUserId_idx" ON "public"."Campaign"("webmasterUserId");

-- CreateIndex
CREATE INDEX "Campaign_organizationId_routeId_idx" ON "public"."Campaign"("organizationId", "routeId");

-- CreateIndex
CREATE INDEX "Lead_organizationId_userId_idx" ON "public"."Lead"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "Route_userId_idx" ON "public"."Route"("userId");

-- CreateIndex
CREATE INDEX "Route_organizationId_userId_idx" ON "public"."Route"("organizationId", "userId");

-- AddForeignKey
ALTER TABLE "public"."WebmasterProfile" ADD CONSTRAINT "WebmasterProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Route" ADD CONSTRAINT "Route_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Campaign" ADD CONSTRAINT "Campaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Campaign" ADD CONSTRAINT "Campaign_webmasterUserId_fkey" FOREIGN KEY ("webmasterUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AccessControl" ADD CONSTRAINT "AccessControl_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AccessControl" ADD CONSTRAINT "AccessControl_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AccessControl" ADD CONSTRAINT "AccessControl_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "public"."Route"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AccessControl" ADD CONSTRAINT "AccessControl_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Lead" ADD CONSTRAINT "Lead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
