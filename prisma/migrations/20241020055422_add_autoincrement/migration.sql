/*
  Warnings:

  - The `routeId` column on the `Route` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "Route" DROP COLUMN "routeId",
ADD COLUMN     "routeId" SERIAL NOT NULL;
