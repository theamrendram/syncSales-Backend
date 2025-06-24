const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Create a new role
const createRole = async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { name, description, permissions } = req.body;
    const userId = req.user.id;

    // Check if user has permission to manage roles
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

    const userPermissions = membership.role.permissions;
    if (!userPermissions.canManageRoles) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You do not have permission to manage roles.",
      });
    }

    // Check if role name already exists in organization
    const existingRole = await prisma.role.findFirst({
      where: {
        name,
        organizationId,
      },
    });

    if (existingRole) {
      return res.status(400).json({
        success: false,
        message: "Role name already exists in this organization",
      });
    }

    const role = await prisma.role.create({
      data: {
        name,
        description,
        permissions,
        organizationId,
      },
    });

    res.status(201).json({
      success: true,
      data: role,
      message: "Role created successfully",
    });
  } catch (error) {
    console.error("Error creating role:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create role",
      error: error.message,
    });
  }
};

// Get all roles for an organization
const getRoles = async (req, res) => {
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

    const roles = await prisma.role.findMany({
      where: { organizationId },
      include: {
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
          },
        },
      },
    });

    res.json({
      success: true,
      data: roles,
    });
  } catch (error) {
    console.error("Error fetching roles:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch roles",
      error: error.message,
    });
  }
};

// Update a role
const updateRole = async (req, res) => {
  try {
    const { organizationId, roleId } = req.params;
    const { name, description, permissions } = req.body;
    const userId = req.user.id;

    // Check if user has permission to manage roles
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

    const userPermissions = membership.role.permissions;
    if (!userPermissions.canManageRoles) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You do not have permission to manage roles.",
      });
    }

    // Check if role exists and belongs to organization
    const existingRole = await prisma.role.findFirst({
      where: {
        id: roleId,
        organizationId,
      },
    });

    if (!existingRole) {
      return res.status(404).json({
        success: false,
        message: "Role not found",
      });
    }

    // Prevent updating owner role
    if (existingRole.name === "owner") {
      return res.status(400).json({
        success: false,
        message: "Cannot modify owner role",
      });
    }

    // Check if new name conflicts with existing role
    if (name && name !== existingRole.name) {
      const nameConflict = await prisma.role.findFirst({
        where: {
          name,
          organizationId,
          id: { not: roleId },
        },
      });

      if (nameConflict) {
        return res.status(400).json({
          success: false,
          message: "Role name already exists in this organization",
        });
      }
    }

    const role = await prisma.role.update({
      where: { id: roleId },
      data: {
        name,
        description,
        permissions,
      },
    });

    res.json({
      success: true,
      data: role,
      message: "Role updated successfully",
    });
  } catch (error) {
    console.error("Error updating role:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update role",
      error: error.message,
    });
  }
};

// Delete a role
const deleteRole = async (req, res) => {
  try {
    const { organizationId, roleId } = req.params;
    const userId = req.user.id;

    // Check if user has permission to manage roles
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

    const userPermissions = membership.role.permissions;
    if (!userPermissions.canManageRoles) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You do not have permission to manage roles.",
      });
    }

    // Check if role exists and belongs to organization
    const existingRole = await prisma.role.findFirst({
      where: {
        id: roleId,
        organizationId,
      },
      include: {
        members: true,
      },
    });

    if (!existingRole) {
      return res.status(404).json({
        success: false,
        message: "Role not found",
      });
    }

    // Prevent deleting owner role
    if (existingRole.name === "owner") {
      return res.status(400).json({
        success: false,
        message: "Cannot delete owner role",
      });
    }

    // Check if role has members
    if (existingRole.members.length > 0) {
      return res.status(400).json({
        success: false,
        message:
          "Cannot delete role that has members. Please reassign members first.",
      });
    }

    await prisma.role.delete({
      where: { id: roleId },
    });

    res.json({
      success: true,
      message: "Role deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting role:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete role",
      error: error.message,
    });
  }
};

// Update member role
const updateMemberRole = async (req, res) => {
  try {
    const { organizationId, memberId } = req.params;
    const { roleId } = req.body;
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

    const userPermissions = membership.role.permissions;
    if (!userPermissions.canManageMembers) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You do not have permission to manage members.",
      });
    }

    // Check if member exists
    const member = await prisma.organizationMember.findFirst({
      where: {
        id: memberId,
        organizationId,
      },
    });

    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Member not found",
      });
    }

    // Check if new role exists and belongs to organization
    const newRole = await prisma.role.findFirst({
      where: {
        id: roleId,
        organizationId,
      },
    });

    if (!newRole) {
      return res.status(404).json({
        success: false,
        message: "Role not found",
      });
    }

    // Prevent changing owner's role
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (organization.ownerId === member.userId) {
      return res.status(400).json({
        success: false,
        message: "Cannot change organization owner's role",
      });
    }

    const updatedMember = await prisma.organizationMember.update({
      where: { id: memberId },
      data: { roleId },
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
      data: updatedMember,
      message: "Member role updated successfully",
    });
  } catch (error) {
    console.error("Error updating member role:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update member role",
      error: error.message,
    });
  }
};

module.exports = {
  createRole,
  getRoles,
  updateRole,
  deleteRole,
  updateMemberRole,
};
