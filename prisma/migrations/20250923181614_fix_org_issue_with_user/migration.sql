/*
  Warnings:

  - You are about to drop the column `companyId` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `Seller` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[ownerId]` on the table `Organization` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[organizationId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."User" DROP COLUMN "companyId",
ADD COLUMN     "organizationId" TEXT;

-- DropTable
DROP TABLE "public"."Seller";

-- CreateIndex
CREATE UNIQUE INDEX "Organization_ownerId_key" ON "public"."Organization"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "User_organizationId_key" ON "public"."User"("organizationId");
