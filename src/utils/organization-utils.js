const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Get user's organization context
const getUserOrganizationContext = async (userId) => {
  try {
    const memberships = await prisma.organizationMember.findMany({
      where: {
        userId,
        status: "active",
      },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            description: true,
            domain: true,
            logo: true,
          },
        },
        role: {
          select: {
            id: true,
            name: true,
            permissions: true,
          },
        },
      },
    });

    return memberships;
  } catch (error) {
    console.error("Error getting user organization context:", error);
    throw error;
  }
};

// Filter data by organization
const filterByOrganization = (data, organizationId) => {
  if (!organizationId) return data;

  return data.filter((item) => {
    // Handle different data structures
    if (item.organizationId) {
      return item.organizationId === organizationId;
    }
    if (item.organization && item.organization.id) {
      return item.organization.id === organizationId;
    }
    return false;
  });
};

// Add organization filter to Prisma queries
const addOrganizationFilter = (whereClause, organizationId) => {
  if (!organizationId) return whereClause;

  return {
    ...whereClause,
    organizationId: organizationId,
  };
};

// Check if user has access to specific data
const checkDataAccess = async (userId, dataId, dataType, organizationId) => {
  try {
    // First check if user is member of the organization
    const membership = await prisma.organizationMember.findFirst({
      where: {
        userId,
        organizationId,
        status: "active",
      },
      include: {
        role: true,
      },
    });

    if (!membership) {
      return { hasAccess: false, reason: "Not a member of organization" };
    }

    // Check if data belongs to the organization
    let data;
    switch (dataType) {
      case "lead":
        data = await prisma.lead.findFirst({
          where: {
            id: dataId,
            organizationId,
          },
        });
        break;
      case "campaign":
        data = await prisma.campaign.findFirst({
          where: {
            id: dataId,
            organizationId,
          },
        });
        break;
      case "route":
        data = await prisma.route.findFirst({
          where: {
            id: dataId,
            organizationId,
          },
        });
        break;
      case "webmaster":
        data = await prisma.webmaster.findFirst({
          where: {
            id: dataId,
            organizationId,
          },
        });
        break;
      case "payment":
        data = await prisma.payment.findFirst({
          where: {
            id: dataId,
            organizationId,
          },
        });
        break;
      default:
        return { hasAccess: false, reason: "Invalid data type" };
    }

    if (!data) {
      return { hasAccess: false, reason: "Data not found in organization" };
    }

    return {
      hasAccess: true,
      membership,
      permissions: membership.role.permissions,
    };
  } catch (error) {
    console.error("Error checking data access:", error);
    return { hasAccess: false, reason: "Error checking access" };
  }
};

// Get organization statistics
const getOrganizationStats = async (organizationId) => {
  try {
    const [
      totalLeads,
      totalCampaigns,
      totalRoutes,
      totalWebmasters,
      totalMembers,
      totalPayments,
    ] = await Promise.all([
      prisma.lead.count({ where: { organizationId } }),
      prisma.campaign.count({ where: { organizationId } }),
      prisma.route.count({ where: { organizationId } }),
      prisma.webmaster.count({ where: { organizationId } }),
      prisma.organizationMember.count({
        where: {
          organizationId,
          status: "active",
        },
      }),
      prisma.payment.count({ where: { organizationId } }),
    ]);

    return {
      totalLeads,
      totalCampaigns,
      totalRoutes,
      totalWebmasters,
      totalMembers,
      totalPayments,
    };
  } catch (error) {
    console.error("Error getting organization stats:", error);
    throw error;
  }
};

// Migrate existing data to organization context
const migrateDataToOrganization = async (userId, organizationId) => {
  try {
    // Update user's existing data to include organizationId
    await Promise.all([
      prisma.lead.updateMany({
        where: { userId },
        data: { organizationId },
      }),
      prisma.campaign.updateMany({
        where: { userId },
        data: { organizationId },
      }),
      prisma.route.updateMany({
        where: { userId },
        data: { organizationId },
      }),
      prisma.webmaster.updateMany({
        where: { userId },
        data: { organizationId },
      }),
      prisma.payment.updateMany({
        where: { userId },
        data: { organizationId },
      }),
      prisma.subscription.updateMany({
        where: { userId },
        data: { organizationId },
      }),
      prisma.userPlan.updateMany({
        where: { userId },
        data: { organizationId },
      }),
    ]);

    return { success: true, message: "Data migrated successfully" };
  } catch (error) {
    console.error("Error migrating data to organization:", error);
    throw error;
  }
};

// Get user's primary organization (first one they're a member of)
const getPrimaryOrganization = async (userId) => {
  try {
    const membership = await prisma.organizationMember.findFirst({
      where: {
        userId,
        status: "active",
      },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            description: true,
            domain: true,
            logo: true,
          },
        },
        role: {
          select: {
            id: true,
            name: true,
            permissions: true,
          },
        },
      },
      orderBy: {
        joinedAt: "asc",
      },
    });

    return membership;
  } catch (error) {
    console.error("Error getting primary organization:", error);
    return null;
  }
};

module.exports = {
  getUserOrganizationContext,
  filterByOrganization,
  addOrganizationFilter,
  checkDataAccess,
  getOrganizationStats,
  migrateDataToOrganization,
  getPrimaryOrganization,
};
