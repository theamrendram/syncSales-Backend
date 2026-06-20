const prisma = require("./prismaClient");

/**
 * Seeded roles for each organization (same shape as organization signup).
 * Webmasters use the "viewer" membership role; effective API permissions
 * for users with WebmasterProfile are overridden in auth middleware.
 */
const DEFAULT_ORG_ROLES = [
  {
    name: "owner",
    description: "Full access to all features",
    permissions: {
      canManageOrganization: true,
      canManageMembers: true,
      canManageRoles: true,
      canViewAllData: true,
      canEditAllData: true,
      canDeleteData: true,
      canManageBilling: true,
    },
  },
  {
    name: "admin",
    description: "Administrative access",
    permissions: {
      canManageOrganization: false,
      canManageMembers: true,
      canManageRoles: false,
      canViewAllData: true,
      canEditAllData: true,
      canDeleteData: true,
      canManageBilling: false,
    },
  },
  {
    name: "manager",
    description: "Manager access",
    permissions: {
      canManageOrganization: false,
      canManageMembers: false,
      canManageRoles: false,
      canViewAllData: true,
      canEditAllData: true,
      canDeleteData: false,
      canManageBilling: false,
    },
  },
  {
    name: "viewer",
    description: "Read-only access",
    permissions: {
      canManageOrganization: false,
      canManageMembers: false,
      canManageRoles: false,
      canViewAllData: true,
      canEditAllData: false,
      canDeleteData: false,
      canManageBilling: false,
    },
  },
];

/**
 * Creates any missing default roles (e.g. org created before role seeding existed).
 */
async function ensureDefaultRolesForOrganization(organizationId) {
  for (const def of DEFAULT_ORG_ROLES) {
    const existing = await prisma.role.findFirst({
      where: { organizationId, name: def.name },
    });
    if (!existing) {
      await prisma.role.create({
        data: {
          name: def.name,
          description: def.description,
          permissions: def.permissions,
          organizationId,
        },
      });
    }
  }
}

module.exports = {
  DEFAULT_ORG_ROLES,
  ensureDefaultRolesForOrganization,
};
