-- WebmasterProfile folded into User.
--
-- "Webmaster" is no longer a kind of account. isActive, leadLimit and payout are
-- member attributes, so they move onto User; what makes a member's view narrower
-- is now the presence of CampaignWebmaster / AccessControl grants, not a profile
-- row.
--
-- Order matters: the columns are added and backfilled before the table is
-- dropped, so no existing webmaster loses their state.

-- 1. Add the columns with the defaults WebmasterProfile used.
ALTER TABLE "User" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "leadLimit" INTEGER;
ALTER TABLE "User" ADD COLUMN "payout" DOUBLE PRECISION;

-- 2. Carry across whatever each existing profile held.
UPDATE "User" u
SET "isActive"  = wp."isActive",
    "leadLimit" = wp."leadLimit",
    "payout"    = wp."payout"
FROM "WebmasterProfile" wp
WHERE wp."userId" = u."id";

-- 3. The profile table has no reader left.
DROP TABLE IF EXISTS "WebmasterProfile";
