/*
  Warnings:

  - A unique constraint covering the columns `[sellerId,campId]` on the table `Campaign` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Campaign_sellerId_campId_key" ON "Campaign"("sellerId", "campId");
