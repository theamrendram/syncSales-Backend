import prismaClient from "../utils/prismaClient.js";
import auth from "../lib/auth.js";
import logger from "../utils/logger.js";
import { generateKey } from "../utils/generate-key.js";
import { DEFAULT_ROLE } from "../lib/org-roles.js";
import { ensureDefaultRolesForOrganization } from "../utils/default-org-roles.js";
import { getExplicitRouteIdsForWebmaster } from "../utils/webmaster-campaigns.js";

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

    // Resolved BEFORE the account exists. signUpEmail writes the User row
    // itself, so bailing out after it would strand a half-built webmaster —
    // an account with no organization that the "user already exists" check
    // above would then refuse to let anyone recreate.
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

    // Better Auth owns identity, so the account is created through it and the
    // webmaster-specific columns are attached to the row it returns. The
    // "webmaster" role is not stored on the identity provider any more: it is
    // implied by the presence of a WebmasterProfile, which is what the auth
    // middleware and the CRM already read.
    //
    // Errors deliberately fall through to the catch below, which maps Better
    // Auth's APIError body (duplicate email, weak password) onto 422.
    const signUp = await auth.api.signUpEmail({
      body: { name: `${firstName} ${lastName}`.trim(), email, password },
    });

    const newUserId = signUp?.user?.id;
    if (!newUserId) {
      return res.status(500).json({ error: "Account creation returned no user" });
    }

    const createdUser = await prismaClient.user.update({
      where: { id: newUserId },
      data: {
        // Previously the API key was the identity provider's user id, which
        // made a public credential equal to a user identifier. It is now an
        // independently generated secret.
        apiKey: generateKey(),
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
        // Written alongside the legacy row so the organization plugin sees the
        // membership too. Both tables are maintained until the legacy pair is
        // removed.
        memberships: {
          create: {
            organizationId: ownerOrganization.id,
            role: DEFAULT_ROLE,
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
    // Better Auth reports validation problems (weak password, duplicate email)
    // as APIError with a body carrying a code. Surface those as 422 the way the
    // previous provider's errors were, so the CRM's existing handling still
    // shows a usable message.
    const apiBody = error?.body;
    if (apiBody?.message || apiBody?.code) {
      return res.status(422).json({
        error: apiBody.message || "Unable to create webmaster",
        code: apiBody.code,
      });
    }
    logger.error({ err: error }, "addWebmaster failed");
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

    // Suspending a webmaster has to end their access now, not whenever their
    // session happens to expire. WebmasterProfile.isActive gates new requests;
    // deleting the sessions closes the ones already open.
    if (isActive === false) {
      const { count } = await prismaClient.session.deleteMany({
        where: { userId: updated.id },
      });
      logger.info(
        { userId: updated.id, revoked: count },
        "webmaster deactivated; sessions revoked",
      );
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

    // Session, Account and Member all cascade from User, so this single delete
    // removes the identity along with the row.
    await prismaClient.user.delete({
      where: { id },
    });

    res.status(200).json({ message: "Webmaster deleted" });
  } catch (error) {
    res
      .status(400)
      .json({ error: "Unable to delete webmaster", details: error.message });
  }
};

export { addWebmaster, getWebmasters, getWebmasterById, updateWebmaster, deleteWebmaster };
