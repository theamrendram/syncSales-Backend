-- API keys belong to the organization owner, advertisers and publishers only.
-- A user without a key now holds NULL instead of "0" or a "nokey_" placeholder.

ALTER TABLE "User" ALTER COLUMN "apiKey" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "apiKey" DROP NOT NULL;

UPDATE "User" SET "apiKey" = NULL
WHERE "apiKey" = '0' OR "apiKey" LIKE 'nokey\_%';

-- Withdraw every key that is not an owner's, an advertiser's or a publisher's
-- (admins, managers, users with no organization). Owner keys are untouched.
UPDATE "User" u SET "apiKey" = NULL
WHERE u."apiKey" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Organization" o WHERE o."ownerId" = u."id")
  AND NOT EXISTS (
    SELECT 1 FROM "OrganizationMember" m
    WHERE m."userId" = u."id" AND m."role" IN ('advertiser', 'publisher')
  );

-- Advertisers and publishers without a key get one, in generateKey()'s format
-- (32 hex characters). md5 of a random uuid avoids depending on pgcrypto.
UPDATE "User" u SET "apiKey" = md5(gen_random_uuid()::text || clock_timestamp()::text)
WHERE u."apiKey" IS NULL
  AND EXISTS (
    SELECT 1 FROM "OrganizationMember" m
    WHERE m."userId" = u."id" AND m."role" IN ('advertiser', 'publisher')
  );

ALTER TABLE "Invitation" ADD COLUMN "campaignIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Invitation" ADD COLUMN "routeIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
