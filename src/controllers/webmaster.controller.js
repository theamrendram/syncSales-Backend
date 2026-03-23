const { clerkClient } = require("@clerk/express");
const prismaClient = require("../utils/prismaClient");

const addWebmaster = async (req, res) => {
  const { email: emailAddress, password, fullName, campaigns } = await req.body;
  console.log("adding new webmaster", req.body);
  const { userId } = req.auth;
  const email = emailAddress.toLowerCase();
  try {
    const ownerOrganization = await prismaClient.organization.findUnique({
      where: { ownerId: userId },
      select: { id: true },
    });

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
      res.status(400).json({ error: "User already exists" });
      return;
    }

    const response = await clerkClient.users.createUser({
      username: fullName.split(" ")[0] + Math.floor(Math.random() * 1000),
      emailAddress: [email],
      password,
      firstName: fullName.split(" ")[0],
      lastName: fullName.split(" ")[1] || "",
      deleteSelfEnabled: false,
    });

    await clerkClient.users.updateUserMetadata(response.id, {
      privateMetadata: {
        role: "webmaster",
      },
    });

    const memberRole = await prismaClient.role.findFirst({
      where: {
        organizationId: ownerOrganization.id,
        name: "viewer",
      },
    });

    if (!memberRole) {
      return res.status(500).json({
        error: "Organization roles not initialized. Run organization setup first.",
      });
    }

    const createdUser = await prismaClient.user.create({
      data: {
        id: response.id,
        firstName: fullName.split(" ")[0],
        lastName: fullName.split(" ")[1] || "",
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

    const campaignConnections = Array.isArray(campaigns)
      ? campaigns.map((campaignId) => ({
          id: campaignId,
        }))
      : [];

    if (campaignConnections.length) {
      await prismaClient.campaign.updateMany({
        where: {
          id: { in: campaignConnections.map((c) => c.id) },
          organizationId: ownerOrganization.id,
        },
        data: {
          webmasterUserId: createdUser.id,
        },
      });
    }

    const assignedCampaigns = await prismaClient.campaign.findMany({
      where: {
        webmasterUserId: createdUser.id,
      },
    });

    console.log("Webmaster created with campaigns:", assignedCampaigns);

    res.status(201).json({
      message: "Webmaster created",
      webmaster: {
        id: createdUser.id,
        email: createdUser.email,
        firstName: createdUser.firstName,
        lastName: createdUser.lastName,
        name: `${createdUser.firstName} ${createdUser.lastName}`,
        campaigns: assignedCampaigns,
      },
    });
  } catch (error) {
    console.log("error", error);
    if (error.clerkError && Array.isArray(error.errors) && error.errors.length > 0) {
      const clerkError = error.errors[0];
      return res.status(422).json({
        error: clerkError.longMessage || clerkError.message || "Unable to create webmaster",
        code: clerkError.code,
      });
    }
    res
      .status(400)
      .json({ error: "Unable to create webmaster", details: error.message });
  }
};

const getWebmastersByUser = async (req, res) => {
  try {
    const { userId } = req.auth;
    const ownerOrganization = await prismaClient.organization.findUnique({
      where: { ownerId: userId },
      select: { id: true },
    });

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
        assignedWebmasterCampaigns: true,
      },
    });

    const formatted = webmasters.map((w) => ({
      id: w.id,
      email: w.email,
      firstName: w.firstName,
      lastName: w.lastName,
      isActive: w.webmasterProfile?.isActive ?? true,
      campaigns: w.assignedWebmasterCampaigns,
    }));

    console.log("Webmasters found:", formatted);
    res.status(200).json(formatted);
  } catch (error) {
    console.error("Error fetching webmasters:", error);
    res
      .status(400)
      .json({ error: "Unable to get webmasters", details: error.message });
  }
};

const updateWebmaster = async (req, res) => {
  const { id } = req.params;
  const { campaigns, firstName, lastName, isActive } = req.body;
  try {
    const { userId } = req.auth;
    const ownerOrganization = await prismaClient.organization.findUnique({
      where: { ownerId: userId },
      select: { id: true },
    });

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
        assignedWebmasterCampaigns: true,
      },
    });

    if (!current || !ownerOrganization?.id) {
      return res.status(404).json({ error: "Webmaster not found" });
    }

    const newCampaignIds = Array.isArray(campaigns) ? campaigns : [];

    await prismaClient.campaign.updateMany({
      where: { webmasterUserId: id },
      data: { webmasterUserId: null },
    });

    if (newCampaignIds.length) {
      await prismaClient.campaign.updateMany({
        where: {
          id: { in: newCampaignIds },
          organizationId: ownerOrganization.id,
        },
        data: { webmasterUserId: id },
      });
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
                : current.webmasterProfile?.isActive ?? true,
          },
        },
      },
      include: {
        webmasterProfile: true,
        assignedWebmasterCampaigns: true,
      },
    });

    if (isActive === false) {
      await clerkClient.users.lockUser(updated.id);
    } else if (isActive === true) {
      await clerkClient.users.unlockUser(updated.id);
    }

    console.log("webmaster updated", updated);
    res.status(200).json({
      id: updated.id,
      email: updated.email,
      firstName: updated.firstName,
      lastName: updated.lastName,
      isActive: updated.webmasterProfile?.isActive ?? true,
      campaigns: updated.assignedWebmasterCampaigns,
    });
  } catch (error) {
    console.log("error", error);
    res
      .status(400)
      .json({ error: "Unable to update webmaster", details: error.message });
  }
};

const deleteWebmaster = async (req, res) => {
  const { id } = req.params;
  try {
    const { userId } = req.auth;
    const ownerOrganization = await prismaClient.organization.findUnique({
      where: { ownerId: userId },
      select: { id: true },
    });

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

    await prismaClient.campaign.updateMany({
      where: { webmasterUserId: id },
      data: { webmasterUserId: null },
    });

    await prismaClient.user.delete({
      where: { id },
    });

    await clerkClient.users.deleteUser(id);

    res.status(200).json({ message: "Webmaster deleted" });
  } catch (error) {
    console.log("error deleting webmaster", error);
    res
      .status(400)
      .json({ error: "Unable to delete webmaster", details: error.message });
  }
};

module.exports = {
  addWebmaster,
  getWebmastersByUser,
  updateWebmaster,
  deleteWebmaster,
};
