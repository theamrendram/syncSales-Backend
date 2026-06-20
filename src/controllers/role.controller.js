const prisma = require("../utils/prismaClient");

function assertRoleRouteContext(req, organizationId) {
  return (
    req.authContext &&
    req.authContext.organizationId === organizationId &&
    req.auth?.userId
  );
}

// Create a new role (disabled for MVP — seeded roles only)
const createRole = async (req, res) => {
  return res.status(403).json({
    success: false,
    message:
      "Custom role creation is disabled for this release. Use seeded roles only.",
  });
};

// Get all roles for an organization
const getRoles = async (req, res) => {
  try {
    const { organizationId } = req.params;

    if (!assertRoleRouteContext(req, organizationId)) {
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

// Update a role (disabled for MVP — seeded roles only)
const updateRole = async (req, res) => {
  return res.status(403).json({
    success: false,
    message:
      "Custom role updates are disabled for this release. Use seeded roles only.",
  });
};

// Delete a role (disabled for MVP — seeded roles only)
const deleteRole = async (req, res) => {
  return res.status(403).json({
    success: false,
    message:
      "Custom role deletion is disabled for this release. Use seeded roles only.",
  });
};

// Update member role
const updateMemberRole = async (req, res) => {
  try {
    const { organizationId, memberId } = req.params;
    const { roleId } = req.body;

    if (!assertRoleRouteContext(req, organizationId)) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You are not a member of this organization.",
      });
    }

    if (!req.authContext.permissions?.canManageMembers) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You do not have permission to manage members.",
      });
    }

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

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!organization) {
      return res.status(404).json({
        success: false,
        message: "Organization not found",
      });
    }

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
