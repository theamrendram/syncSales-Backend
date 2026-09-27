-- Drop Member.
--
-- The Better Auth organization plugin now reads and writes OrganizationMember
-- directly (src/lib/auth.js maps its `member` model onto it), so this table has
-- no reader left. Every row was mirrored into OrganizationMember first; the
-- migration was gated on that parity being exact.
DROP TABLE IF EXISTS "Member";
