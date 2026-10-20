import { z } from "zod";
import prisma from "../utils/core/prismaClient.js";
import { DEFAULT_ORG_ROLES } from "../utils/access/default-org-roles.js";
import { upsertMembership, removeMembership } from "../lib/membership.js";
import { ASSIGNABLE_ROLES } from "../lib/org-access-control.js";
import { isNarrowedRole } from "../lib/org-roles.js";
import {
  MAX_GRANTS,
  parseGrants,
  hasAnyGrant,
  grantsBelongToOrg,
  getMemberGrants,
  replaceGrants,
  GRANT_TX_OPTIONS,
} from "../lib/member-grants.js";

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

// What the Organization page shows. Explicit select: the old include asked for
// relations that no longer exist (members.role is a name now, not a relation).
const organizationSelect = {
  id: true,
  name: true,
  description: true,
  domain: true,
  logo: true,
  slug: true,
  createdAt: true,
  ownerId: true,
  allowMemberPasswordManagement: true,
  allowMemberSocialLinking: true,
  owner: { select: { id: true, name: true, email: true } },
};

async function sendOrganization(req, res, organizationId) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: organizationSelect,
  });
  if (!organization) {
    return res.status(404).json({ error: "Organization not found" });
  }
  return res.status(200).json({
    success: true,
    data: {
      organization,
      // authContext.role is the Role row; the page wants the name.
      role:
        req.authContext.membership?.role ??
        (req.authContext.isOrganizationOwner ? "owner" : null),
      isOwner: Boolean(req.authContext.isOrganizationOwner),
      permissions: [...(req.authContext.permissions ?? [])],
    },
  });
}

// Get organization details
const getOrganization = async (req, res) => {
  try {
    const { organizationId } = req.params;
    if (!req.authContext || req.authContext.organizationId !== organizationId) {
      return res
        .status(403)
        .json({ error: "Access denied. You are not a member of this organization." });
    }
    return await sendOrganization(req, res, organizationId);
  } catch (error) {
    req.log.error({ err: error }, "failed to fetch organization");
    return res.status(500).json({ error: "Failed to fetch organization" });
  }
};

// The caller's active organization, so the client never has to know its id.
const getCurrentOrganization = async (req, res) => {
  try {
    const organizationId = req.authContext?.organizationId;
    if (!organizationId) {
      return res.status(404).json({ error: "No active organization" });
    }
    return await sendOrganization(req, res, organizationId);
  } catch (error) {
    req.log.error({ err: error }, "failed to fetch current organization");
    return res.status(500).json({ error: "Failed to fetch organization" });
  }
};

const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const updateOrganizationSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: optionalText(500),
    domain: optionalText(255),
    logo: z
      .union([z.literal(""), z.string().trim().url().max(2048)])
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
  })
  .strict();

// Update organization
const updateOrganization = async (req, res) => {
  try {
    const { organizationId } = req.params;
    if (!req.authContext || req.authContext.organizationId !== organizationId) {
      return res
        .status(403)
        .json({ error: "Access denied. You are not a member of this organization." });
    }

    const parsed = updateOrganizationSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message ?? "Invalid organization details",
        field: parsed.error.issues[0]?.path?.[0],
      });
    }

    const organization = await prisma.organization.update({
      where: { id: organizationId },
      data: parsed.data,
      select: organizationSelect,
    });

    return res.status(200).json({ success: true, data: organization });
  } catch (error) {
    req.log.error({ err: error }, "failed to update organization");
    return res.status(500).json({ error: "Failed to update organization" });
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

    // Same rule as role changes and invitations: an advertiser or publisher is
    // only added together with the campaigns or routes they may see.
    let grants = null;
    if (isNarrowedRole(role.name)) {
      grants = parseGrants({
        campaignIds: req.body.campaignIds ?? [],
        routeIds: req.body.routeIds ?? [],
      });
      if (!hasAnyGrant(grants)) {
        return res.status(400).json({ error: "Assign at least one campaign or route" });
      }
      if (!(await grantsBelongToOrg(organizationId, grants))) {
        return res
          .status(400)
          .json({ error: "Some campaigns or routes do not belong to this organization" });
      }
    }

    await prisma.$transaction(async (tx) => {
      await upsertMembership({
        client: tx,
        userId: user.id,
        organizationId,
        role: role.name,
      });
      if (grants) {
        await replaceGrants({ client: tx, userId: user.id, organizationId, ...grants });
      }
    }, GRANT_TX_OPTIONS);

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

    if (member.userId === req.authContext.userId) {
      return res.status(400).json({ error: "You can't remove yourself" });
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

// Get organization members. Gated by member:manage in the route: it lists emails.
const getMembers = async (req, res) => {
  try {
    const { organizationId } = req.params;
    if (!req.authContext || req.authContext.organizationId !== organizationId) {
      return res
        .status(403)
        .json({ error: "Access denied. You are not a member of this organization." });
    }

    const [members, organization] = await Promise.all([
      prisma.organizationMember.findMany({
        where: { organizationId },
        orderBy: { joinedAt: "asc" },
        take: 500,
        select: {
          id: true,
          role: true,
          joinedAt: true,
          user: { select: { id: true, name: true, email: true, image: true } },
        },
      }),
      prisma.organization.findUnique({
        where: { id: organizationId },
        select: { ownerId: true },
      }),
    ]);

    return res.status(200).json({
      success: true,
      data: members.map((m) => ({
        ...m,
        isOwner: m.user.id === organization?.ownerId,
      })),
    });
  } catch (error) {
    req.log.error({ err: error }, "failed to fetch members");
    return res.status(500).json({ error: "Failed to fetch members" });
  }
};

const grantIds = z.array(z.string().uuid()).max(MAX_GRANTS);
const updateMemberRoleSchema = z
  .object({
    role: z.enum(ASSIGNABLE_ROLES),
    // Access to go with an advertiser or publisher role, applied in the same
    // transaction. Omitted, the member's current access is kept.
    campaignIds: grantIds.optional(),
    routeIds: grantIds.optional(),
  })
  .strict();

// Change a member's role. Ownership is never assigned here, the owner's own row
// is fixed, and nobody changes their own role (an admin demoting themselves by
// accident would have no way back).
const updateMemberRole = async (req, res) => {
  try {
    const { organizationId, memberId } = req.params;
    if (!req.authContext || req.authContext.organizationId !== organizationId) {
      return res
        .status(403)
        .json({ error: "Access denied. You are not a member of this organization." });
    }

    const parsed = updateMemberRoleSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: `Role must be one of: ${ASSIGNABLE_ROLES.join(", ")}` });
    }

    const [member, organization] = await Promise.all([
      prisma.organizationMember.findFirst({
        where: { id: memberId, organizationId },
        select: { id: true, userId: true },
      }),
      prisma.organization.findUnique({
        where: { id: organizationId },
        select: { ownerId: true },
      }),
    ]);
    if (!member) {
      return res.status(404).json({ error: "Member not found" });
    }
    if (member.userId === organization?.ownerId) {
      return res.status(400).json({ error: "The owner's role can't be changed" });
    }
    if (member.userId === req.authContext.userId) {
      return res.status(400).json({ error: "You can't change your own role" });
    }

    const { role } = parsed.data;
    const sentGrants =
      parsed.data.campaignIds || parsed.data.routeIds
        ? {
          campaignIds: [...new Set(parsed.data.campaignIds ?? [])],
          routeIds: [...new Set(parsed.data.routeIds ?? [])],
        }
        : null;

    // An advertiser or publisher with nothing assigned sees nothing and cannot
    // send leads, so the role is only handed out together with some access —
    // sent now, or already held (advertiser <-> publisher keeps its grants).
    const grants = isNarrowedRole(role) ? sentGrants : null;
    if (isNarrowedRole(role)) {
      const effective = grants ?? (await getMemberGrants(member.userId, organizationId));
      if (!hasAnyGrant(effective)) {
        return res.status(400).json({ error: "Assign at least one campaign or route" });
      }
      if (grants && !(await grantsBelongToOrg(organizationId, grants))) {
        return res
          .status(400)
          .json({ error: "Some campaigns or routes do not belong to this organization" });
      }
    }

    await prisma.$transaction(async (tx) => {
      if (grants) {
        await replaceGrants({ client: tx, userId: member.userId, organizationId, ...grants });
      }
      await upsertMembership({ client: tx, userId: member.userId, organizationId, role });
    }, GRANT_TX_OPTIONS);

    req.log.info(
      { evt: "member_role_updated", organizationId, memberId, role: parsed.data.role },
      "member role updated",
    );
    return res.status(200).json({
      success: true,
      data: { id: member.id, role: parsed.data.role },
    });
  } catch (error) {
    req.log.error({ err: error }, "failed to update member role");
    return res.status(500).json({ error: "Failed to update member role" });
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

export { createOrganization, getOrganization, updateOrganization, addMember, removeMember, getMembers, getUserOrganizations, updateMemberAuthSettings, getCurrentOrganization, updateMemberRole };
