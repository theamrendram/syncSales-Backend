/*
  Warnings:

  - A unique constraint covering the columns `[email]` on the table `Webmaster` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Webmaster_email_key" ON "Webmaster"("email");
