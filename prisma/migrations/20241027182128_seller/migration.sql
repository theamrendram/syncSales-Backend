-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "sellerId" TEXT;

-- CreateTable
CREATE TABLE "Seller" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,

    CONSTRAINT "Seller_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_CampaignToSeller" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_CampaignToSeller_AB_unique" ON "_CampaignToSeller"("A", "B");

-- CreateIndex
CREATE INDEX "_CampaignToSeller_B_index" ON "_CampaignToSeller"("B");

-- AddForeignKey
ALTER TABLE "_CampaignToSeller" ADD CONSTRAINT "_CampaignToSeller_A_fkey" FOREIGN KEY ("A") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CampaignToSeller" ADD CONSTRAINT "_CampaignToSeller_B_fkey" FOREIGN KEY ("B") REFERENCES "Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;
