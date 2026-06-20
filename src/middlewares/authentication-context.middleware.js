const { validate: uuidValidate } = require("uuid");
const prisma = require("../utils/prismaClient");
const {
  PERMISSION_KEYS,
  WEBMASTER_PERMISSIONS,
} = require("../utils/role-permissions-schema");

const OWNER_FALLBACK_PERMISSIONS = {
  canManageOrganization: true,
  canManageMembers: true,
  canManageRoles: true,
  canViewAllData: true,
  canEditAllData: true,
  canDeleteData: true,
  canManageBilling: true,
};

function normalizePermissions(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  for (const k of PERMISSION_KEYS) {
    out[k] = raw[k] === true;
  }
  return out;
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
    where: { userId, status: "active" },
    orderBy: { joinedAt: "asc" },
    select: { organizationId: true },
  });
  return membership?.organizationId ?? null;
}

async function resolveIsWebmaster(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { webmasterProfile: { select: { userId: true } } },
  });
  return Boolean(user?.webmasterProfile);
}

async function buildAuthContextForOrg(userId, organizationId, isWebmaster) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, ownerId: true },
  });

  if (!org) {
    // Fail-closed for org resolution issues.
    return { error: "forbidden", status: 403 };
  }

  const isOwner = org.ownerId === userId;

  const membership = await prisma.organizationMember.findFirst({
    where: { userId, organizationId, status: "active" },
    include: { role: true },
  });

  if (!isOwner && !membership) {
    return { error: "forbidden", status: 403 };
  }

  const role = membership?.role ?? null;
  let permissions = null;

  if (isOwner) {
    permissions = role?.permissions
      ? normalizePermissions(role.permissions)
      : null;
    if (!permissions) {
      permissions = { ...OWNER_FALLBACK_PERMISSIONS };
    }
  } else if (isWebmaster && membership) {
    permissions = normalizePermissions(WEBMASTER_PERMISSIONS);
  } else if (role?.permissions) {
    permissions = normalizePermissions(role.permissions);
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
      isWebmaster,
    },
  };
}

function attachContext(req, context) {
  req.authContext = context;
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

      const isWebmaster = await resolveIsWebmaster(userId);

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
        const result = await buildAuthContextForOrg(userId, pathOrgId, isWebmaster);
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
        const result = await buildAuthContextForOrg(userId, defaultOrgId, isWebmaster);
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

    if (ctx.isWebmaster && !ctx.organizationId) {
      if (
        permission === "canViewAllData" &&
        ctx.permissions?.canViewAllData === true
      ) {
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

    if (ctx.permissions?.[permission] !== true) {
      return res.status(403).json({
        success: false,
        error: "Forbidden",
        message: `Missing permission: ${permission}`,
      });
    }

    next();
  };
}

module.exports = {
  authenticationContext,
  requireOrgPermission,
  extractPathOrganizationId,
  normalizePermissions,
  OWNER_FALLBACK_PERMISSIONS,
};
