const { clerkClient } = require("@clerk/express");
const prismaClient = require("../utils/prismaClient");
const {
  ensureDefaultRolesForOrganization,
} = require("../utils/default-org-roles");
const {
  getExplicitRouteIdsForWebmaster,
} = require("../utils/webmaster-campaigns");

const getOwnerOrganization = async (userId) => {
  return prismaClient.organization.findUnique({
    where: { ownerId: userId },
    select: { id: true },
  });
};

const formatWebmaster = (w) => ({
  id: w.id,
  email: w.email,
  firstName: w.firstName,
  lastName: w.lastName,
  isActive: w.webmasterProfile?.isActive ?? true,
  campaigns: (w.webmasterCampaignMemberships || [])
    .map((m) => m.campaign)
    .filter(Boolean),
  routes: (w.resourceAccess || [])
    .map((a) => a.route)
    .filter(Boolean),
});

const addWebmaster = async (req, res) => {
  const {
    email: emailAddress,
    password,
    fullName,
    campaigns,
    routes,
  } = await req.body;
  const { userId } = req.auth;

  if (!emailAddress || !password || !fullName) {
    return res.status(400).json({
      error: "Missing required fields: email, password, fullName",
    });
  }

  const email = String(emailAddress).toLowerCase();
  const normalizedCampaigns = Array.isArray(campaigns) ? campaigns : [];
  const normalizedRoutes = Array.isArray(routes) ? routes : [];
  if (!normalizedCampaigns.length && !normalizedRoutes.length) {
    return res.status(400).json({
      error: "Assign at least one campaign or route.",
    });
  }

  try {
    const ownerOrganization = await getOwnerOrganization(userId);
    console.log("[addWebmaster] ownerOrganization: ", ownerOrganization);
    if (!ownerOrganization?.id) {
      return res.status(400).json({
        error:
          "Owner organization not found. Create an organization before adding webmasters.",
      });
    }

    const existingUser = await prismaClient.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(400).json({ error: "User already exists" });
    }

    console.log("[addWebmaster] existingUser: ", existingUser);

    const [firstName, ...rest] = String(fullName).trim().split(" ");
    const lastName = rest.join(" ") || "";

    const response = await clerkClient.users.createUser({
      username: firstName + Math.floor(Math.random() * 1000),
      emailAddress: [email],
      password,
      firstName,
      lastName,
      deleteSelfEnabled: false,
    });

    await clerkClient.users.updateUserMetadata(response.id, {
      privateMetadata: {
        role: "webmaster",
      },
    });

    await ensureDefaultRolesForOrganization(ownerOrganization.id);

    const memberRole = await prismaClient.role.findFirst({
      where: {
        organizationId: ownerOrganization.id,
        name: "viewer",
      },
    });

    if (!memberRole) {
      return res.status(500).json({
        error: "Could not resolve viewer role for this organization.",
      });
    }

    const createdUser = await prismaClient.user.create({
      data: {
        id: response.id,
        firstName,
        lastName,
        email,
        password,
        apiKey: response.id,
        organizationId: ownerOrganization.id,
        webmasterProfile: {
          create: {
            isActive: true,
          },
        },
        organizationMemberships: {
          create: {
            organizationId: ownerOrganization.id,
            roleId: memberRole.id,
            status: "active",
          },
        },
      },
      include: {
        webmasterProfile: true,
      },
    });

    if (normalizedCampaigns.length) {
      const validCampaigns = await prismaClient.campaign.findMany({
        where: {
          id: { in: normalizedCampaigns.map(String) },
          organizationId: ownerOrganization.id,
        },
        select: { id: true },
      });
      if (validCampaigns.length) {
        await prismaClient.campaignWebmaster.createMany({
          data: validCampaigns.map((c) => ({
            campaignId: c.id,
            userId: createdUser.id,
          })),
          skipDuplicates: true,
        });
      }
    }
    if (normalizedRoutes.length) {
      const validRoutes = await prismaClient.route.findMany({
        where: {
          id: { in: normalizedRoutes.map(String) },
          organizationId: ownerOrganization.id,
        },
        select: { id: true },
      });
      if (validRoutes.length) {
        await prismaClient.accessControl.createMany({
          data: validRoutes.map((r) => ({
            userId: createdUser.id,
            organizationId: ownerOrganization.id,
            routeId: r.id,
            accessType: "view",
          })),
          skipDuplicates: true,
        });
      }
    }

    const links = await prismaClient.campaignWebmaster.findMany({
      where: { userId: createdUser.id },
      include: { campaign: true },
    });
    const assignedCampaigns = links.map((l) => l.campaign);
    const explicitRouteIds = await getExplicitRouteIdsForWebmaster(
      createdUser.id,
      ownerOrganization.id,
    );
    const assignedRoutes = explicitRouteIds.length
      ? await prismaClient.route.findMany({
          where: { id: { in: explicitRouteIds } },
        })
      : [];

    res.status(201).json({
      message: "Webmaster created",
      webmaster: {
        id: createdUser.id,
        email: createdUser.email,
        firstName: createdUser.firstName,
        lastName: createdUser.lastName,
        name: `${createdUser.firstName} ${createdUser.lastName}`,
        campaigns: assignedCampaigns,
        routes: assignedRoutes,
      },
    });
  } catch (error) {
    if (
      error.clerkError &&
      Array.isArray(error.errors) &&
      error.errors.length > 0
    ) {
      const clerkError = error.errors[0];
      return res.status(422).json({
        error:
          clerkError.longMessage ||
          clerkError.message ||
          "Unable to create webmaster",
        code: clerkError.code,
      });
    }
    res
      .status(400)
      .json({ error: "Unable to create webmaster", details: error.message });
  }
};

const getWebmasters = async (req, res) => {
  try {
    const { userId } = req.auth;
    const ownerOrganization = await getOwnerOrganization(userId);

    if (!ownerOrganization?.id) {
      return res.status(400).json({ error: "Owner organization not found" });
    }

    const webmasters = await prismaClient.user.findMany({
      where: {
        webmasterProfile: { isNot: null },
        organizationMemberships: {
          some: {
            organizationId: ownerOrganization.id,
            status: "active",
          },
        },
      },
      include: {
        webmasterProfile: true,
        webmasterCampaignMemberships: {
          include: { campaign: true },
        },
        resourceAccess: {
          where: { routeId: { not: null }, accessType: "view" },
          include: { route: true },
        },
      },
    });

    return res.status(200).json(webmasters.map(formatWebmaster));
  } catch (error) {
    res
      .status(400)
      .json({ error: "Unable to get webmasters", details: error.message });
  }
};

const getWebmasterById = async (req, res) => {
  const { id } = req.params;
  try {
    const { userId } = req.auth;
    const ownerOrganization = await getOwnerOrganization(userId);
    if (!ownerOrganization?.id) {
      return res.status(400).json({ error: "Owner organization not found" });
    }

    const current = await prismaClient.user.findFirst({
      where: {
        id,
        webmasterProfile: { isNot: null },
        organizationMemberships: {
          some: {
            organizationId: ownerOrganization.id,
            status: "active",
          },
        },
      },
      include: {
        webmasterProfile: true,
        webmasterCampaignMemberships: {
          include: { campaign: true },
        },
        resourceAccess: {
          where: { routeId: { not: null }, accessType: "view" },
          include: { route: true },
        },
      },
    });

    if (!current) {
      return res.status(404).json({ error: "Webmaster not found" });
    }

    return res.status(200).json(formatWebmaster(current));
  } catch (error) {
    return res
      .status(400)
      .json({ error: "Unable to get webmaster", details: error.message });
  }
};

const updateWebmaster = async (req, res) => {
  const { id } = req.params;
  const { campaigns, routes, firstName, lastName, isActive } = req.body;
  try {
    const { userId } = req.auth;
    const ownerOrganization = await getOwnerOrganization(userId);

    const current = await prismaClient.user.findFirst({
      where: {
        id,
        webmasterProfile: { isNot: null },
        organizationMemberships: {
          some: {
            organizationId: ownerOrganization?.id,
            status: "active",
          },
        },
      },
      include: {
        webmasterProfile: true,
        webmasterCampaignMemberships: {
          include: { campaign: true },
        },
      },
    });

    if (!current || !ownerOrganization?.id) {
      return res.status(404).json({ error: "Webmaster not found" });
    }

    const newCampaignIds = Array.isArray(campaigns) ? campaigns : [];
    const newRouteIds = Array.isArray(routes) ? routes : [];

    await prismaClient.campaignWebmaster.deleteMany({
      where: {
        userId: id,
        campaign: { organizationId: ownerOrganization.id },
      },
    });

    if (newCampaignIds.length) {
      const validCampaigns = await prismaClient.campaign.findMany({
        where: {
          id: { in: newCampaignIds.map(String) },
          organizationId: ownerOrganization.id,
        },
        select: { id: true },
      });
      if (validCampaigns.length) {
        await prismaClient.campaignWebmaster.createMany({
          data: validCampaigns.map((c) => ({
            campaignId: c.id,
            userId: id,
          })),
          skipDuplicates: true,
        });
      }
    }
    await prismaClient.accessControl.deleteMany({
      where: {
        userId: id,
        organizationId: ownerOrganization.id,
        routeId: { not: null },
      },
    });

    if (newRouteIds.length) {
      const validRoutes = await prismaClient.route.findMany({
        where: {
          id: { in: newRouteIds.map(String) },
          organizationId: ownerOrganization.id,
        },
        select: { id: true },
      });
      if (validRoutes.length) {
        await prismaClient.accessControl.createMany({
          data: validRoutes.map((r) => ({
            userId: id,
            organizationId: ownerOrganization.id,
            routeId: r.id,
            accessType: "view",
          })),
          skipDuplicates: true,
        });
      }
    }

    const updated = await prismaClient.user.update({
      where: { id },
      data: {
        firstName: firstName ?? current.firstName,
        lastName: lastName ?? current.lastName,
        webmasterProfile: {
          update: {
            isActive:
              typeof isActive === "boolean"
                ? isActive
                : (current.webmasterProfile?.isActive ?? true),
          },
        },
      },
      include: {
        webmasterProfile: true,
        webmasterCampaignMemberships: {
          include: { campaign: true },
        },
        resourceAccess: {
          where: { routeId: { not: null }, accessType: "view" },
          include: { route: true },
        },
      },
    });

    if (isActive === false) {
      await clerkClient.users.lockUser(updated.id);
    } else if (isActive === true) {
      await clerkClient.users.unlockUser(updated.id);
    }

    return res.status(200).json(formatWebmaster(updated));
  } catch (error) {
    res
      .status(400)
      .json({ error: "Unable to update webmaster", details: error.message });
  }
};

const deleteWebmaster = async (req, res) => {
  const { id } = req.params;
  try {
    const requestingUserId = req.auth.userId;
    const ownerOrganization = await getOwnerOrganization(requestingUserId);

    const current = await prismaClient.user.findFirst({
      where: {
        id,
        webmasterProfile: { isNot: null },
        organizationMemberships: {
          some: {
            organizationId: ownerOrganization?.id,
            status: "active",
          },
        },
      },
    });

    if (!current || !ownerOrganization?.id) {
      res.status(404).json({ error: "Webmaster not found" });
      return;
    }

    await prismaClient.campaignWebmaster.deleteMany({
      where: { userId: id },
    });

    await prismaClient.organizationMember.deleteMany({
      where: { userId: id },
    });

    await prismaClient.lead.updateMany({
      where: { userId: id },
      data: { userId: requestingUserId },
    });

    await prismaClient.route.updateMany({
      where: { userId: id },
      data: { userId: requestingUserId },
    });

    await prismaClient.user.delete({
      where: { id },
    });

    await clerkClient.users.deleteUser(id);

    res.status(200).json({ message: "Webmaster deleted" });
  } catch (error) {
    res
      .status(400)
      .json({ error: "Unable to delete webmaster", details: error.message });
  }
};

module.exports = {
  addWebmaster,
  getWebmasters,
  getWebmasterById,
  updateWebmaster,
  deleteWebmaster,
};
