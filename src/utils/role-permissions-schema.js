import { z } from "zod";
import { PERMISSIONS, toPermissionList } from "../lib/org-roles.js";

/**
 * Validation for a stored `Role.permissions` value.
 *
 * The stored shape is a list of `resource:action` strings, each of which must be
 * one the catalog in src/lib/org-roles.js defines. Rejecting unknown strings on
 * the way in is the point: a permission that exists in the table but nowhere in
 * code is either a typo that silently denies, or a grant someone expects to be
 * honoured and which never will be.
 *
 * Duplicates are collapsed rather than rejected — a list naming the same grant
 * twice means exactly what it says.
 */
const rolePermissionsSchema = z
  .array(z.enum(PERMISSIONS))
  .transform((list) => [...new Set(list)]);

function parseRolePermissions(input) {
  return rolePermissionsSchema.parse(input);
}

function safeParseRolePermissions(input) {
  return rolePermissionsSchema.safeParse(input);
}

/**
 * Parse a value that may still be in the legacy boolean-object shape.
 *
 * For reading rows written before permissions became strings. Writes should use
 * parseRolePermissions, which refuses the old shape outright.
 */
function parseStoredRolePermissions(input) {
  return rolePermissionsSchema.parse(toPermissionList(input));
}

export {
  PERMISSIONS,
  rolePermissionsSchema,
  parseRolePermissions,
  safeParseRolePermissions,
  parseStoredRolePermissions,
};
