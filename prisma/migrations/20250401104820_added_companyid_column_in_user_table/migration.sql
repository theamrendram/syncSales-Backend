-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "companyId" TEXT;

-- CreateIndex
CREATE INDEX "Lead_companyId_idx" ON "Lead"("companyId");
