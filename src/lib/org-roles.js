/**
 * Organization roles, as code.
 *
 * These four roles were already frozen: role.controller.js rejects create,
 * update and delete with "Custom role creation is disabled for this release",
 * so the `Role` table only ever held four rows per organization, seeded
 * identically every time. Holding them in a table bought nothing and cost a
 * join on permission checks, so they live here now.
 *
 * Better Auth's organization plugin stores a role *name* on each member row.
 * That name indexes into this map, which keeps `requireOrgPermission("...")`
 * working with the same permission keys the middleware and routes already use.
 */

export const ORG_ROLES = ["owner", "admin", "manager", "viewer"];

export const DEFAULT_ROLE = "viewer";

export const ROLE_DESCRIPTIONS = {
  owner: "Full access to all features",
  admin: "Administrative access",
  manager: "Manager access",
  viewer: "Read-only access",
};

export const ROLE_PERMISSIONS = {
  owner: {
    canManageOrganization: true,
    canManageMembers: true,
    canManageRoles: true,
    canViewAllData: true,
    canEditAllData: true,
    canDeleteData: true,
    canManageBilling: true,
  },
  admin: {
    canManageOrganization: false,
    canManageMembers: true,
    canManageRoles: false,
    canViewAllData: true,
    canEditAllData: true,
    canDeleteData: true,
    canManageBilling: false,
  },
  manager: {
    canManageOrganization: false,
    canManageMembers: false,
    canManageRoles: false,
    canViewAllData: true,
    canEditAllData: true,
    canDeleteData: false,
    canManageBilling: false,
  },
  viewer: {
    canManageOrganization: false,
    canManageMembers: false,
    canManageRoles: false,
    canViewAllData: true,
    canEditAllData: false,
    canDeleteData: false,
    canManageBilling: false,
  },
};

/**
 * Permissions for a role name. Unknown or missing names collapse to the
 * least-privileged role rather than to "no permissions object", so callers
 * never have to distinguish "absent" from "denied".
 */
export function permissionsForRole(roleName) {
  return ROLE_PERMISSIONS[roleName] ?? ROLE_PERMISSIONS[DEFAULT_ROLE];
}

export function isKnownRole(roleName) {
  return Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, roleName);
}
