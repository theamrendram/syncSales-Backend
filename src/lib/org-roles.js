/**
 * Organization roles and permissions.
 *
 * Permissions are `resource:action` strings — `campaign:read`, `route:delete`,
 * `member:manage`. The previous scheme was seven flat booleans
 * (`canViewAllData`, `canEditAllData`, `canDeleteData`, …) where the three data
 * keys covered *every* resource at once: a role that could edit campaigns could
 * necessarily edit routes, and nothing could express otherwise. Naming the
 * resource makes the guard on a route say what it actually protects, and makes
 * narrower roles possible without inventing more booleans.
 *
 * A role grants a list. Anything not listed is denied — there are no negative
 * grants, so a missing permission and a refused one are the same thing and no
 * caller has to tell them apart.
 *
 * These roles are frozen: role.controller.js rejects create,
 * update and delete, so the `Role` table only ever holds these rows per
 * organization. They live here, and src/utils/default-org-roles.js seeds the
 * table from them rather than restating them.
 *
 * There is deliberately no "webmaster" here. A webmaster is a member whose role
 * grants reads and whose *rows* are narrowed to the campaigns linked to them —
 * which is resource access, a later stage than permissions, and something no
 * permission string can express. Making it a role said nothing the role list did
 * not already say, and put a scoping concern in the permission catalog.
 */

/** Everything a permission can be granted over. */
export const RESOURCES = [
  "organization",
  "member",
  "role",
  "billing",
  "apikey",
  "lead",
  "campaign",
  "route",
];

/**
 * read/write/delete apply to the data resources; manage is for the
 * administrative ones, where a partial grant would be meaningless — there is no
 * useful "can read billing but not change it" in this product.
 */
export const DATA_RESOURCES = ["lead", "campaign", "route"];
// Adding, editing and removing webmasters is member management, so it needs no
// resource of its own — `member:manage` covers it.
// `apikey:manage` issues, rotates and revokes publisher keys.
export const ADMIN_RESOURCES = ["organization", "member", "role", "billing", "apikey"];

export const READ = "read";
export const WRITE = "write";
export const DELETE = "delete";
export const MANAGE = "manage";

const dataPermissions = (action) => DATA_RESOURCES.map((r) => `${r}:${action}`);

/** Every permission string that exists. Anything else is invalid, not merely ungranted. */
export const PERMISSIONS = [
  ...ADMIN_RESOURCES.map((r) => `${r}:${MANAGE}`),
  ...dataPermissions(READ),
  ...dataPermissions(WRITE),
  ...dataPermissions(DELETE),
];

export const ORG_ROLES = ["owner", "admin", "manager", "advertiser", "publisher"];

export const DEFAULT_ROLE = "advertiser";

/**
 * Roles that only ever see what was assigned to them. For everyone else, no
 * grants means the whole organization; for these, no grants means nothing —
 * a freshly invited client or publisher must not see every campaign before
 * anyone has decided what is theirs.
 */
export const NARROWED_ROLES = ["advertiser", "publisher"];

/** Roles that may hold an API key, i.e. send leads and call the postback. */
export const KEY_ROLES = ["owner", "admin", "publisher"];

export const ROLE_DESCRIPTIONS = {
  owner: "Full access to all features",
  admin: "Administrative access",
  manager: "Manager access",
  advertiser: "Sees and updates leads for assigned campaigns",
  publisher: "Sends leads; sees only the leads they sent",
};

export const isNarrowedRole = (role) => NARROWED_ROLES.includes(role);
export const isKeyRole = (role) => KEY_ROLES.includes(role);

export const ROLE_PERMISSIONS = {
  // Everything, including the administrative resources.
  owner: [...PERMISSIONS],

  // All data, and may manage members and their API keys — but cannot change the
  // organization itself, redefine roles, or touch billing.
  admin: [
    "member:manage",
    "apikey:manage",
    ...dataPermissions(READ),
    ...dataPermissions(WRITE),
    ...dataPermissions(DELETE),
  ],

  // Read and write, but never delete.
  manager: [...dataPermissions(READ), ...dataPermissions(WRITE)],

  // The client. Reads everything assigned to them and moves lead statuses; never
  // creates or removes campaigns or routes.
  advertiser: [...dataPermissions(READ), "lead:write"],

  // An outside lead source. Reads only: leads arrive through their API key, and
  // their status changes come back through the postback, never the dashboard.
  publisher: [...dataPermissions(READ)],
};

/**
 * Permissions for a role name. Unknown or missing names collapse to the
 * least-privileged role rather than to "no permissions at all", so callers never
 * have to distinguish "absent" from "denied".
 */
export function permissionsForRole(roleName) {
  return [...(ROLE_PERMISSIONS[roleName] ?? ROLE_PERMISSIONS[DEFAULT_ROLE])];
}

export function isKnownRole(roleName) {
  return Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, roleName);
}

export function isKnownPermission(permission) {
  return PERMISSIONS.includes(permission);
}

/** True when `permission` names a read action, whatever its resource. */
export function isReadPermission(permission) {
  return String(permission).endsWith(`:${READ}`);
}

/**
 * The flat booleans this scheme replaced, mapped to what they granted.
 *
 * Rows written before the change still hold the old object, and a deploy lands
 * before any repair script runs. Reading both shapes means the order of those
 * two events cannot cause an outage — without it, every stored role would read
 * as "no permissions" for the window in between, which fails closed but locks
 * everyone out.
 */
const LEGACY_KEY_MAP = {
  canManageOrganization: ["organization:manage"],
  canManageMembers: ["member:manage"],
  canManageRoles: ["role:manage"],
  canManageBilling: ["billing:manage"],
  canViewAllData: dataPermissions(READ),
  canEditAllData: dataPermissions(WRITE),
  canDeleteData: dataPermissions(DELETE),
};

/**
 * A stored `Role.permissions` value as a list of permission strings.
 *
 * Accepts the current shape (an array of strings), the legacy shape (an object
 * of booleans), and anything else as empty. Unknown strings are dropped rather
 * than trusted, so a typo in the table cannot grant something real.
 */
export function toPermissionList(raw) {
  if (Array.isArray(raw)) {
    return raw.filter((p) => isKnownPermission(p));
  }

  if (raw && typeof raw === "object") {
    const out = new Set();
    for (const [key, granted] of Object.entries(raw)) {
      if (granted !== true) continue;
      // A row that already holds the new shape as object keys reads correctly too.
      if (isKnownPermission(key)) {
        out.add(key);
        continue;
      }
      for (const p of LEGACY_KEY_MAP[key] ?? []) out.add(p);
    }
    return [...out];
  }

  return [];
}
