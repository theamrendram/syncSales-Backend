const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Middleware to check if user is member of organization
const requireOrganizationMembership = async (req, res, next) => {
  try {
    const { organizationId } = req.params;
    const userId = req.user.id;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: "Organization ID is required",
      });
    }

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
      return res.status(403).json({
        success: false,
        message: "Access denied. You are not a member of this organization.",
      });
    }

    // Add membership info to request
    req.organizationMembership = membership;
    req.userRole = membership.role;
    req.userPermissions = membership.role.permissions;

    next();
  } catch (error) {
    console.error("Error in organization membership check:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Middleware to check specific permissions
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.userPermissions) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Permission check failed.",
      });
    }

    if (!req.userPermissions[permission]) {
      return res.status(403).json({
        success: false,
        message: `Access denied. You do not have permission to ${permission}.`,
      });
    }

    next();
  };
};

// Middleware to check if user is organization owner
const requireOrganizationOwner = async (req, res, next) => {
  try {
    const { organizationId } = req.params;
    const userId = req.user.id;

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!organization) {
      return res.status(404).json({
        success: false,
        message: "Organization not found",
      });
    }

    if (organization.ownerId !== userId) {
      return res.status(403).json({
        success: false,
        message:
          "Access denied. Only organization owner can perform this action.",
      });
    }

    next();
  } catch (error) {
    console.error("Error in organization owner check:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Middleware to add organization context to all organization-related requests
const addOrganizationContext = async (req, res, next) => {
  try {
    const { organizationId } = req.params;

    if (organizationId) {
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          id: true,
          name: true,
          description: true,
          domain: true,
          logo: true,
        },
      });

      if (organization) {
        req.organization = organization;
      }
    }

    next();
  } catch (error) {
    console.error("Error adding organization context:", error);
    next(); // Continue even if context addition fails
  }
};

// Helper function to get user's organizations
const getUserOrganizations = async (userId) => {
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
    console.error("Error getting user organizations:", error);
    throw error;
  }
};

// Helper function to check if user has permission in any organization
const hasPermissionInAnyOrganization = async (userId, permission) => {
  try {
    const memberships = await prisma.organizationMember.findMany({
      where: {
        userId,
        status: "active",
      },
      include: {
        role: true,
      },
    });

    return memberships.some(
      (membership) => membership.role.permissions[permission]
    );
  } catch (error) {
    console.error("Error checking permissions:", error);
    return false;
  }
};

module.exports = {
  requireOrganizationMembership,
  requirePermission,
  requireOrganizationOwner,
  addOrganizationContext,
  getUserOrganizations,
  hasPermissionInAnyOrganization,
};
