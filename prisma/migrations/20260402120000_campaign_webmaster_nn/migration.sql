-- CreateTable
CREATE TABLE "public"."CampaignWebmaster" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignWebmaster_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignWebmaster_campaignId_userId_key" ON "public"."CampaignWebmaster"("campaignId", "userId");

CREATE INDEX "CampaignWebmaster_userId_idx" ON "public"."CampaignWebmaster"("userId");

CREATE INDEX "CampaignWebmaster_campaignId_idx" ON "public"."CampaignWebmaster"("campaignId");

-- AddForeignKey
ALTER TABLE "public"."CampaignWebmaster" ADD CONSTRAINT "CampaignWebmaster_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."CampaignWebmaster" ADD CONSTRAINT "CampaignWebmaster_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill from legacy single-webmaster-per-campaign column
INSERT INTO "public"."CampaignWebmaster" ("id", "campaignId", "userId", "createdAt")
SELECT gen_random_uuid()::text, "id", "webmasterUserId", CURRENT_TIMESTAMP
FROM "public"."Campaign"
WHERE "webmasterUserId" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "public"."Campaign" DROP CONSTRAINT "Campaign_webmasterUserId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "public"."Campaign_webmasterUserId_idx";

-- AlterTable
ALTER TABLE "public"."Campaign" DROP COLUMN "webmasterUserId";
