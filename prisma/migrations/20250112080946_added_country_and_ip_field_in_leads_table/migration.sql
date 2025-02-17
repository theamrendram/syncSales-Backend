/*
  Warnings:

  - You are about to drop the column `county` on the `Lead` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Lead" DROP COLUMN "county",
ADD COLUMN     "country" TEXT;
