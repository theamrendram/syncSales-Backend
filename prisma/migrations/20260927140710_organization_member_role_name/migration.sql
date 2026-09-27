-- OrganizationMember.roleId -> OrganizationMember.role (a Role.name)
--
-- Role is @@unique([name, organizationId]), so the name identifies a role row as
-- precisely as the id did. Storing the name is what lets the Better Auth
-- organization plugin read this table directly; it expects a role name, and
-- cannot be pointed at a uuid foreign key.
--
-- Order matters: the column is added and backfilled before roleId is dropped, so
-- no membership loses its role.

-- 1. Add the column with a safe default, so existing rows are valid immediately.
ALTER TABLE "OrganizationMember" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'viewer';

-- 2. Backfill from the role each membership currently points at.
UPDATE "OrganizationMember" om
SET "role" = r."name"
FROM "Role" r
WHERE r."id" = om."roleId";

-- 3. Drop the foreign key, its index and the column it served.
DROP INDEX IF EXISTS "OrganizationMember_roleId_idx";
ALTER TABLE "OrganizationMember" DROP CONSTRAINT IF EXISTS "OrganizationMember_roleId_fkey";
ALTER TABLE "OrganizationMember" DROP COLUMN "roleId";

-- 4. status only ever held 'active'; removeMember deletes rather than deactivates.
ALTER TABLE "OrganizationMember" DROP COLUMN "status";
DROP TYPE IF EXISTS "MemberStatus";
