/*
  Warnings:

  - You are about to drop the column `subscriptionId` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "subscriptionId",
ADD COLUMN     "expiry" TEXT,
ADD COLUMN     "orderId" TEXT[],
ADD COLUMN     "plan" TEXT NOT NULL DEFAULT 'pro';
