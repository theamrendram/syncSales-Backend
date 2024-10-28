/*
  Warnings:

  - Made the column `sellerId` on table `Campaign` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Campaign" ALTER COLUMN "sellerId" SET NOT NULL;
