/*
  Warnings:

  - The `subscriptionId` column on the `User` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "Address" TEXT,
ADD COLUMN     "address" TEXT,
DROP COLUMN "subscriptionId",
ADD COLUMN     "subscriptionId" TEXT[];
