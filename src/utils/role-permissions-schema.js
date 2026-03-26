const { z } = require("zod");

const PERMISSION_KEYS = [
  "canManageOrganization",
  "canManageMembers",
  "canManageRoles",
  "canViewAllData",
  "canEditAllData",
  "canDeleteData",
  "canManageBilling",
];

const rolePermissionsSchema = z.object(
  Object.fromEntries(PERMISSION_KEYS.map((k) => [k, z.boolean()]))
);

function parseRolePermissions(input) {
  return rolePermissionsSchema.parse(input);
}

function safeParseRolePermissions(input) {
  return rolePermissionsSchema.safeParse(input);
}

module.exports = {
  PERMISSION_KEYS,
  rolePermissionsSchema,
  parseRolePermissions,
  safeParseRolePermissions,
};
