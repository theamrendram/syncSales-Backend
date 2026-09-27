import { validate as uuidValidate } from "uuid";
import prisma from "../utils/prismaClient.js";
import logger from "../utils/logger.js";
import {
  PERMISSIONS,
  isReadPermission,
  toPermissionList,
} from "../lib/org-roles.js";

/** An owner is never locked out by missing or malformed role data. */
const OWNER_FALLBACK_PERMISSIONS = [...PERMISSIONS];

/**
 * A stored Role.permissions value as a permission list, or null when it holds
 * nothing usable.
 *
 * Null and "granted nothing" are kept apart on purpose: the caller treats an
 * unreadable row as a reason to fall back (for an owner) or to refuse, whereas a
 * role that legitimately grants nothing is a valid answer.
 */
function normalizePermissions(raw) {
  if (raw === null || raw === undefined) return null;
  const list = toPermissionList(raw);
  return list.length ? list : null;
}

/**
 * Org id from URL: /api/v1/org/:uuid/... or /api/v1/org/role/:uuid/...
 * Excludes /api/v1/org/user. Uses req.params when Express has populated it.
 */
function extractPathOrganizationId(req) {
  const param = req.params?.organizationId;
  if (param && uuidValidate(param)) {
    return param;
  }

  const path = (req.originalUrl || "").split("?")[0];

  if (path.startsWith("/api/v1/org/role/")) {
    const rest = path.slice("/api/v1/org/role/".length);
    const first = rest.split("/").filter(Boolean)[0];
    return first && uuidValidate(first) ? first : null;
  }

  if (path.startsWith("/api/v1/org/")) {
    const rest = path.slice("/api/v1/org/".length);
    const first = rest.split("/").filter(Boolean)[0];
    if (!first || first === "user" || first === "role") {
      return null;
    }
    return uuidValidate(first) ? first : null;
  }

  return null;
}

async function resolveDefaultOrganizationId(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { organizationId: true },
  });
  if (user?.organizationId) {
    return user.organizationId;
  }
  const membership = await prisma.organizationMember.findFirst({
    where: { userId },
    orderBy: { joinedAt: "asc" },
    select: { organizationId: true },
  });
  return membership?.organizationId ?? null;
}

async function buildAuthContextForOrg(userId, organizationId) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      ownerId: true,
      // OrganizationMember stores a role *name* now, not a foreign key, so the
      // role row is fetched alongside the organization rather than joined from
      // the membership. An organization has a handful of roles, so this keeps the
      // request at the same two queries it took before.
      Role: { select: { name: true, permissions: true } },
    },
  });

  if (!org) {
    // Fail-closed for org resolution issues.
    return { error: "forbidden", status: 403 };
  }

  const isOwner = org.ownerId === userId;

  const membership = await prisma.organizationMember.findFirst({
    where: { userId, organizationId },
    include: {
      // Loaded here rather than in a query of its own: this is the only place
      // that needs it, and it used to cost a separate User lookup on every
      // authenticated request.
      user: { select: { webmasterProfile: { select: { userId: true } } } },
    },
  });

  if (!isOwner && !membership) {
    return { error: "forbidden", status: 403 };
  }

  // membership.role is a name; the row carrying its permissions came back with
  // the organization above. A name with no matching row resolves to null and is
  // refused below, rather than being treated as a role that grants nothing.
  //
  // `?? []` matters: this is authorization code, and throwing here would surface
  // as a 500 rather than a refusal. An organization with no roles readable must
  // deny (or fall back, for an owner), not crash.
  const roles = Array.isArray(org.Role) ? org.Role : [];
  const role = roles.find((r) => r.name === membership?.role) ?? null;
  let permissions = null;

  // The role on the membership row is the only thing that decides permissions.
  // WebmasterProfile used to override them here, which meant a member's effective
  // permissions did not match the role their membership claimed. It now affects
  // only which rows they see, which is a later stage.
  if (role?.permissions) {
    permissions = normalizePermissions(role.permissions);
  }

  // An owner is never locked out by missing or malformed role data. This is a
  // safety net, not a path: repair-memberships.js gives every owner a real
  // membership row, so it firing means something is missing.
  if (isOwner && !permissions) {
    logger.warn(
      { organizationId: org.id, userId },
      "owner has no usable role permissions; falling back to full access",
    );
    permissions = [...OWNER_FALLBACK_PERMISSIONS];
  }

  if (!permissions || typeof permissions !== "object") {
    return { error: "forbidden", status: 403 };
  }

  return {
    context: {
      userId,
      organizationId: org.id,
      membership,
      role,
      permissions,
      isOrganizationOwner: isOwner,
      // A scoping flag, not a permission one. Permissions come from the role
      // above; this narrows *which rows* the caller sees, via the campaigns and
      // routes linked to them. That is why it is not a role: no permission string
      // can express "only the campaigns assigned to you".
      isWebmaster: Boolean(membership?.user?.webmasterProfile),
    },
  };
}

function attachContext(req, context) {
  const granted = new Set(context.permissions ?? []);
  // Attached here rather than built by each caller so that every context — including
  // the ones that resolve no organization and grant nothing — answers the same way.
  // A Set keeps the check O(1) on a list that is now 16 strings rather than 7 keys.
  req.authContext = {
    ...context,
    can: (permission) => granted.has(permission),
  };
  if (context.organizationId) {
    req.organizationId = context.organizationId;
  } else {
    delete req.organizationId;
  }
}

function isCreateOrganizationRequest(req) {
  if (req.method !== "POST") {
    return false;
  }
  const p = (req.originalUrl || "").split("?")[0];
  return p === "/api/v1/org" || p === "/api/v1/org/";
}

/**
 * Fail-closed auth context: Clerk user → org from path or server default → membership/role/permissions.
 * @param {object} options
 * @param {boolean} [options.requireOrganization=true] — fail closed if no org resolved.
 */
function authenticationContext(options = {}) {
  const {
    requireOrganization = true,
  } = options;

  return async (req, res, next) => {
    try {
      const userId = req.auth?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (
        !requireOrganization &&
        isCreateOrganizationRequest(req)
      ) {
        attachContext(req, {
          userId,
          organizationId: null,
          membership: null,
          role: null,
          permissions: null,
          isOrganizationOwner: false,
          isWebmaster: false,
        });
        return next();
      }

      const pathOrgId = extractPathOrganizationId(req);

      if (pathOrgId) {
        const result = await buildAuthContextForOrg(userId, pathOrgId);
        if (result.error) {
          const msg =
            result.error === "forbidden"
              ? "You are not a member of this organization."
              : "Invalid organization";
          return res.status(result.status).json({
            success: false,
            error: result.error === "forbidden" ? "Forbidden" : "Bad Request",
            message: msg,
          });
        }
        attachContext(req, result.context);
        return next();
      }

      const defaultOrgId = await resolveDefaultOrganizationId(userId);

      if (defaultOrgId) {
        const result = await buildAuthContextForOrg(userId, defaultOrgId);
        if (result.error) {
          if (!requireOrganization) {
            attachContext(req, {
              userId,
              organizationId: null,
              membership: null,
              role: null,
              permissions: null,
              isOrganizationOwner: false,
              isWebmaster: false,
            });
            return next();
          }
          return res.status(result.status).json({
            success: false,
            error: result.error === "forbidden" ? "Forbidden" : "Bad Request",
            message:
              result.error === "forbidden"
                ? "You are not a member of this organization."
                : "Invalid organization",
          });
        }
        attachContext(req, result.context);
        return next();
      }

      if (requireOrganization) {
        return res.status(403).json({
          error: "Forbidden",
          message: "No organization context for this user.",
        });
      }

      attachContext(req, {
        userId,
        organizationId: null,
        membership: null,
        role: null,
        permissions: null,
        isOrganizationOwner: false,
        isWebmaster: false,
      });
      return next();
    } catch (err) {
      console.error("authenticationContext", err);
      return res.status(500).json({
        success: false,
        error: "Failed to resolve authentication context",
      });
    }
  };
}

/**
 * Requires req.authContext from authenticationContext(). Deny if permission is not explicitly true.
 */
function requireOrgPermission(permission) {
  return (req, res, next) => {
    const ctx = req.authContext;
    if (!ctx?.userId) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    // A resource-scoped role with no organization resolved may still read, and
    // only read: their rows are narrowed by AccessControl rather than by the
    // organization, so the absence of one is not by itself a reason to refuse.
    if (ctx.isWebmaster && !ctx.organizationId) {
      if (isReadPermission(permission) && ctx.can(permission)) {
        return next();
      }
      return res.status(403).json({
        success: false,
        error: "Forbidden",
        message: "Insufficient permissions for this resource.",
      });
    }

    if (!ctx.organizationId) {
      return res.status(403).json({
        success: false,
        error: "Forbidden",
        message: "Organization context required.",
      });
    }

    if (!ctx.can(permission)) {
      return res.status(403).json({
        success: false,
        error: "Forbidden",
        message: `Missing permission: ${permission}`,
      });
    }

    next();
  };
}

export { authenticationContext, requireOrgPermission, extractPathOrganizationId, normalizePermissions, OWNER_FALLBACK_PERMISSIONS };
