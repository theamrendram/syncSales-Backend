/*
  Warnings:

  - A unique constraint covering the columns `[apiKey]` on the table `Seller` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Seller_apiKey_key" ON "Seller"("apiKey");
