/**
 * Access control for the Better Auth organization plugin.
 *
 * This only governs the plugin's own endpoints — inviting, cancelling
 * invitations, and its member/organization routes. Everything the API itself
 * guards still goes through requireOrgPermission() and src/lib/org-roles.js.
 * The grants here mirror that file so the two never disagree: owner manages the
 * organization and its members, admin manages members (member:manage), and
 * manager/viewer manage nothing.
 *
 * The plugin used to be given ORG_ROLES, a plain array. It expects a map of
 * role name to access-control role, so it found no role at all — every invite
 * was refused, and "manager"/"viewer" were rejected as unknown roles.
 */
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

export const ac = createAccessControl(defaultStatements);

const manageMembers = {
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
};

export const PLUGIN_ROLES = {
  owner: ac.newRole({ organization: ["update", "delete"], ...manageMembers }),
  admin: ac.newRole(manageMembers),
  manager: ac.newRole({}),
  viewer: ac.newRole({}),
};

/** Roles a member can be invited as, or moved to. Ownership is never handed out this way. */
export const ASSIGNABLE_ROLES = ["admin", "manager", "viewer"];
