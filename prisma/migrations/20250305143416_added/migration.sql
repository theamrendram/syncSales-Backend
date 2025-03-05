-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "webhookResponse" JSONB;

-- AlterTable
ALTER TABLE "Route" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Campaign_campId_idx" ON "Campaign"("campId");

-- CreateIndex
CREATE INDEX "Campaign_status_idx" ON "Campaign"("status");

-- CreateIndex
CREATE INDEX "Campaign_userId_idx" ON "Campaign"("userId");

-- CreateIndex
CREATE INDEX "Campaign_routeId_idx" ON "Campaign"("routeId");

-- CreateIndex
CREATE INDEX "Lead_status_idx" ON "Lead"("status");

-- CreateIndex
CREATE INDEX "Lead_date_idx" ON "Lead"("date");

-- CreateIndex
CREATE INDEX "Lead_userId_idx" ON "Lead"("userId");

-- CreateIndex
CREATE INDEX "Lead_routeId_idx" ON "Lead"("routeId");

-- CreateIndex
CREATE INDEX "Lead_campaignId_idx" ON "Lead"("campaignId");

-- CreateIndex
CREATE INDEX "Lead_phone_idx" ON "Lead"("phone");
