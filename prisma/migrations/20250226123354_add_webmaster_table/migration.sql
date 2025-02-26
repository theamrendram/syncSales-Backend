-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "webMasterId" TEXT;

-- CreateTable
CREATE TABLE "Webmaster" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT,
    "apiKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Webmaster_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Webmaster_apiKey_key" ON "Webmaster"("apiKey");

-- AddForeignKey
ALTER TABLE "Webmaster" ADD CONSTRAINT "Webmaster_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_webMasterId_fkey" FOREIGN KEY ("webMasterId") REFERENCES "Webmaster"("id") ON DELETE SET NULL ON UPDATE CASCADE;
