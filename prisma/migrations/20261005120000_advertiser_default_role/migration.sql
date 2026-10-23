-- "viewer" became "advertiser". Data is moved by
-- scripts/migrate-advertiser-publisher.js; this only changes the defaults.
ALTER TABLE "OrganizationMember" ALTER COLUMN "role" SET DEFAULT 'advertiser';
ALTER TABLE "Invitation" ALTER COLUMN "role" SET DEFAULT 'advertiser';
