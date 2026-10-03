import { z } from "zod";
import prisma from "../utils/prismaClient.js";
import { DEFAULT_ORG_ROLES } from "../utils/default-org-roles.js";
import { upsertMembership, removeMembership } from "../lib/membership.js";

// Create a new organization
const createOrganization = async (req, res) => {
  try {
    const { organizationName, description, domain } = req.body;
    console.log("req.body", req.body);
    const logo = req.file?.path;
    const userId = req.auth.userId;

    // Check if user already owns an organization
    const existingOrg = await prisma.organization.findUnique({
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
        name: organizationName,
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
    const roles = await Promise.all(
      DEFAULT_ORG_ROLES.map((role) =>
        prisma.role.create({
          data: {
            ...role,
            organizationId: organization.id,
          },
        })
      )
    );

    // Owner membership through the shared helper, which also fills
    // User.organizationId. This path used to write OrganizationMember only, which
    // is how organizations created here ended up invisible to the API-key path.
    await upsertMembership({
      userId,
      organizationId: organization.id,
      role: "owner",
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
    if (
      !req.authContext ||
      req.authContext.organizationId !== organizationId
    ) {
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
        userRole: req.authContext.role,
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

    if (
      !req.authContext ||
      req.authContext.organizationId !== organizationId
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You are not a member of this organization.",
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
    const { email, role: roleName, roleId } = req.body;

    if (
      !req.authContext ||
      req.authContext.organizationId !== organizationId
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You are not a member of this organization.",
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

    // Membership stores a role name. Callers that still send the old roleId get
    // it resolved rather than refused, so an existing integration keeps working.
    const role = await prisma.role.findFirst({
      where: roleName
        ? { name: roleName, organizationId }
        : { id: roleId, organizationId },
    });

    if (!role) {
      return res.status(404).json({
        success: false,
        message: "Role not found",
      });
    }

    await upsertMembership({
      userId: user.id,
      organizationId,
      role: role.name,
    });

    const newMember = await prisma.organizationMember.findFirst({
      where: { userId: user.id, organizationId },
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

    if (
      !req.authContext ||
      req.authContext.organizationId !== organizationId
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You are not a member of this organization.",
      });
    }


    const member = await prisma.organizationMember.findFirst({
      where: { id: memberId, organizationId },
    });

    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Member not found",
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
        message: "Cannot remove organization owner",
      });
    }

    // Through the helper so removal has one definition, and so it stays paired
    // with the add path if either gains a second table to maintain.
    await removeMembership({
      userId: member.userId,
      organizationId,
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

    if (
      !req.authContext ||
      req.authContext.organizationId !== organizationId
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You are not a member of this organization.",
      });
    }

    const members = await prisma.organizationMember.findMany({
      where: {
        organizationId,
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

// Owner-only: whether members other than the owner may set/reset a password
// or link a Google account. Enforcement lives in src/lib/member-auth-policy.js.
const memberAuthSettingsSchema = z
  .object({
    allowMemberPasswordManagement: z.boolean().optional(),
    allowMemberSocialLinking: z.boolean().optional(),
  })
  .strict();

const updateMemberAuthSettings = async (req, res) => {
  try {
    const { organizationId } = req.params;
    if (
      !req.authContext ||
      req.authContext.organizationId !== organizationId ||
      !req.authContext.isOrganizationOwner
    ) {
      return res
        .status(403)
        .json({ error: "Only the organization owner can change these settings" });
    }

    const parsed = memberAuthSettingsSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid settings" });
    }

    const data = await prisma.organization.update({
      where: { id: organizationId },
      data: parsed.data,
      select: {
        allowMemberPasswordManagement: true,
        allowMemberSocialLinking: true,
      },
    });

    req.log.info(
      { evt: "member_auth_settings_updated", organizationId, ...data },
      "member auth settings updated",
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    req.log.error({ err: error }, "failed to update member auth settings");
    return res.status(500).json({ error: "Failed to update settings" });
  }
};

export { createOrganization, getOrganization, updateOrganization, addMember, removeMember, getMembers, getUserOrganizations, updateMemberAuthSettings };
