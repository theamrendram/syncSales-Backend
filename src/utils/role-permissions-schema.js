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

/** Fixed preset for users with WebmasterProfile (read-only; scope by campaign links). */
const WEBMASTER_PERMISSIONS = {
  canManageOrganization: false,
  canManageMembers: false,
  canManageRoles: false,
  canViewAllData: true,
  canEditAllData: false,
  canDeleteData: false,
  canManageBilling: false,
};

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
  WEBMASTER_PERMISSIONS,
  rolePermissionsSchema,
  parseRolePermissions,
  safeParseRolePermissions,
};
