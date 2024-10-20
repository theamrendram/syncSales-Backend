/*
  Warnings:

  - You are about to drop the column `webhookId` on the `Route` table. All the data in the column will be lost.
  - You are about to drop the `Webhook` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `attributes` to the `Route` table without a default value. This is not possible if the table is not empty.
  - Added the required column `method` to the `Route` table without a default value. This is not possible if the table is not empty.
  - Added the required column `routeId` to the `Route` table without a default value. This is not possible if the table is not empty.
  - Added the required column `url` to the `Route` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Route" DROP COLUMN "webhookId",
ADD COLUMN     "attributes" JSONB NOT NULL,
ADD COLUMN     "method" TEXT NOT NULL,
ADD COLUMN     "routeId" TEXT NOT NULL,
ADD COLUMN     "url" TEXT NOT NULL;

-- DropTable
DROP TABLE "Webhook";
