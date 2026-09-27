import prisma from "./prismaClient.js";
import {
  ORG_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_PERMISSIONS,
} from "../lib/org-roles.js";
import { parseRolePermissions } from "./role-permissions-schema.js";

/**
 * The Role rows every organization gets.
 *
 * Derived from src/lib/org-roles.js rather than restated here. It used to be a
 * hand-copied duplicate of ROLE_PERMISSIONS, which is exactly the drift this
 * table is vulnerable to: the seed and the code that interprets a role were two
 * lists that had to be kept identical by hand, and nothing checked.
 *
 * Permissions are parsed on the way out, so a malformed entry fails here rather
 * than reaching the database and being read back as authority later.
 */
const DEFAULT_ORG_ROLES = ORG_ROLES.map((name) => ({
  name,
  description: ROLE_DESCRIPTIONS[name] ?? name,
  permissions: parseRolePermissions(ROLE_PERMISSIONS[name]),
}));

/**
 * Creates any role rows this organization is missing.
 *
 * Needed for organizations that predate a role being added — including ones
 * created before role seeding existed at all, which is why it checks each name
 * rather than counting.
 */
async function ensureDefaultRolesForOrganization(organizationId) {
  await prisma.role.createMany({
    data: DEFAULT_ORG_ROLES.map((def) => ({ ...def, organizationId })),
    // Role is @@unique([name, organizationId]), so existing rows are left
    // untouched rather than overwritten — an organization that has customised a
    // role should not have it reset by a seed.
    skipDuplicates: true,
  });
}

export { DEFAULT_ORG_ROLES, ensureDefaultRolesForOrganization };
