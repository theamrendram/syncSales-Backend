const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Create a new organization
const createOrganization = async (req, res) => {
  try {
    const { name, description, domain, logo } = req.body;
    const userId = req.user.id;

    // Check if user already owns an organization
    const existingOrg = await prisma.organization.findFirst({
      where: { ownerId: userId },
    });

    if (existingOrg) {
      return res.status(400).json({
        success: false,
        message: "User already owns an organization",
      });
    }

    // Create organization
    const organization = await prisma.organization.create({
      data: {
        name,
        description,
        domain,
        logo,
        ownerId: userId,
      },
      include: {
        owner: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    // Create default roles for the organization
    const defaultRoles = [
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

    const roles = await Promise.all(
      defaultRoles.map((role) =>
        prisma.role.create({
          data: {
            ...role,
            organizationId: organization.id,
          },
        })
      )
    );

    // Add owner as member with owner role
    const ownerRole = roles.find((role) => role.name === "owner");
    await prisma.organizationMember.create({
      data: {
        userId,
        organizationId: organization.id,
        roleId: ownerRole.id,
        status: "active",
      },
    });

    res.status(201).json({
      success: true,
      data: {
        organization,
        roles,
      },
      message: "Organization created successfully",
    });
  } catch (error) {
    console.error("Error creating organization:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create organization",
      error: error.message,
    });
  }
};

// Get organization details
const getOrganization = async (req, res) => {
  try {
    const { organizationId } = req.params;
    const userId = req.user.id;

    // Check if user is member of the organization
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

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      include: {
        owner: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        members: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            role: true,
          },
        },
        roles: true,
      },
    });

    if (!organization) {
      return res.status(404).json({
        success: false,
        message: "Organization not found",
      });
    }

    res.json({
      success: true,
      data: {
        organization,
        userRole: membership.role,
      },
    });
  } catch (error) {
    console.error("Error fetching organization:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch organization",
      error: error.message,
    });
  }
};

// Update organization
const updateOrganization = async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { name, description, domain, logo } = req.body;
    const userId = req.user.id;

    // Check if user is owner or has permission to manage organization
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

    const permissions = membership.role.permissions;
    if (!permissions.canManageOrganization) {
      return res.status(403).json({
        success: false,
        message:
          "Access denied. You do not have permission to manage this organization.",
      });
    }

    const organization = await prisma.organization.update({
      where: { id: organizationId },
      data: {
        name,
        description,
        domain,
        logo,
      },
      include: {
        owner: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    res.json({
      success: true,
      data: organization,
      message: "Organization updated successfully",
    });
  } catch (error) {
    console.error("Error updating organization:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update organization",
      error: error.message,
    });
  }
};

// Add member to organization
const addMember = async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { email, roleId } = req.body;
    const userId = req.user.id;

    // Check if user has permission to manage members
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

    const permissions = membership.role.permissions;
    if (!permissions.canManageMembers) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You do not have permission to manage members.",
      });
    }

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if user is already a member
    const existingMember = await prisma.organizationMember.findFirst({
      where: {
        userId: user.id,
        organizationId,
      },
    });

    if (existingMember) {
      return res.status(400).json({
        success: false,
        message: "User is already a member of this organization",
      });
    }

    // Verify role exists and belongs to organization
    const role = await prisma.role.findFirst({
      where: {
        id: roleId,
        organizationId,
      },
    });

    if (!role) {
      return res.status(404).json({
        success: false,
        message: "Role not found",
      });
    }

    // Add member
    const newMember = await prisma.organizationMember.create({
      data: {
        userId: user.id,
        organizationId,
        roleId,
        status: "active",
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        role: true,
      },
    });

    res.status(201).json({
      success: true,
      data: newMember,
      message: "Member added successfully",
    });
  } catch (error) {
    console.error("Error adding member:", error);
    res.status(500).json({
      success: false,
      message: "Failed to add member",
      error: error.message,
    });
  }
};

// Remove member from organization
const removeMember = async (req, res) => {
  try {
    const { organizationId, memberId } = req.params;
    const userId = req.user.id;

    // Check if user has permission to manage members
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

    const permissions = membership.role.permissions;
    if (!permissions.canManageMembers) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You do not have permission to manage members.",
      });
    }

    // Check if trying to remove owner
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (organization.ownerId === memberId) {
      return res.status(400).json({
        success: false,
        message: "Cannot remove organization owner",
      });
    }

    // Remove member
    await prisma.organizationMember.delete({
      where: { id: memberId },
    });

    res.json({
      success: true,
      message: "Member removed successfully",
    });
  } catch (error) {
    console.error("Error removing member:", error);
    res.status(500).json({
      success: false,
      message: "Failed to remove member",
      error: error.message,
    });
  }
};

// Get organization members
const getMembers = async (req, res) => {
  try {
    const { organizationId } = req.params;
    const userId = req.user.id;

    // Check if user is member of the organization
    const membership = await prisma.organizationMember.findFirst({
      where: {
        userId,
        organizationId,
        status: "active",
      },
    });

    if (!membership) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You are not a member of this organization.",
      });
    }

    const members = await prisma.organizationMember.findMany({
      where: {
        organizationId,
        status: "active",
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        role: true,
      },
    });

    res.json({
      success: true,
      data: members,
    });
  } catch (error) {
    console.error("Error fetching members:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch members",
      error: error.message,
    });
  }
};

// Get user's organizations
const getUserOrganizations = async (req, res) => {
  try {
    const userId = req.auth.userId;

    const memberships = await prisma.organizationMember.findMany({
      where: {
        userId,
      },
      include: {
        organization: {
          include: {
            owner: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
        role: true,
      },
    });

    res.json({
      success: true,
      data: memberships,
    });
  } catch (error) {
    console.error("Error fetching user organizations:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch user organizations",
      error: error.message,
    });
  }
};

module.exports = {
  createOrganization,
  getOrganization,
  updateOrganization,
  addMember,
  removeMember,
  getMembers,
  getUserOrganizations,
};
