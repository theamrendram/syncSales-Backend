/*
  Warnings:

  - You are about to drop the column `sellerId` on the `Campaign` table. All the data in the column will be lost.
  - You are about to drop the `_CampaignToSeller` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "_CampaignToSeller" DROP CONSTRAINT "_CampaignToSeller_A_fkey";

-- DropForeignKey
ALTER TABLE "_CampaignToSeller" DROP CONSTRAINT "_CampaignToSeller_B_fkey";

-- DropIndex
DROP INDEX "Campaign_sellerId_campId_key";

-- AlterTable
ALTER TABLE "Campaign" DROP COLUMN "sellerId";

-- DropTable
DROP TABLE "_CampaignToSeller";
