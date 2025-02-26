/*
  Warnings:

  - You are about to drop the column `webMasterId` on the `Campaign` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Campaign" DROP CONSTRAINT "Campaign_webMasterId_fkey";

-- AlterTable
ALTER TABLE "Campaign" DROP COLUMN "webMasterId",
ADD COLUMN     "webmasterId" TEXT;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_webmasterId_fkey" FOREIGN KEY ("webmasterId") REFERENCES "Webmaster"("id") ON DELETE SET NULL ON UPDATE CASCADE;
