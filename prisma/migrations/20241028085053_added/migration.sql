/*
  Warnings:

  - Added the required column `campaignId` to the `Lead` table without a default value. This is not possible if the table is not empty.
  - Added the required column `routeId` to the `Lead` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `Lead` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "Status" AS ENUM ('active', 'inactive');

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "status" "Status" NOT NULL DEFAULT 'active';

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "campaignId" TEXT NOT NULL,
ADD COLUMN     "routeId" TEXT NOT NULL,
ADD COLUMN     "userId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
