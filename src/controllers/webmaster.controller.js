const { clerkClient } = require("@clerk/express");
const prismaClient = require("../utils/prismaClient");

const addWebmaster = async (req, res) => {
  const { email: emailAddress, password, fullName, campaigns } = await req.body;
  console.log("adding new webmaster", req.body);
  const { userId } = req.auth;
  const email = emailAddress.toLowerCase();
  try {
    const existingUser = await prismaClient.webmaster.findUnique({
      where: {
        email,
      },
    });

    if (existingUser) {
      res.status(400).json({ error: "User already exists" });
      return;
    }

    // Create Clerk user for the webmaster
    const response = await clerkClient.users.createUser({
      username: fullName.split(" ")[0] + Math.floor(Math.random() * 1000),
      emailAddress: [email],
      password,
      firstName: fullName.split(" ")[0],
      lastName: fullName.split(" ")[1] || "",
      deleteSelfEnabled: false,
    });

    // Set role metadata in Clerk
    await clerkClient.users.updateUserMetadata(response.id, {
      privateMetadata: {
        role: "webmaster",
      },
    });

    // Create a User record in DB using the Clerk user ID as the primary key.
    // All controllers (chart, leads, etc.) look up users via prismaClient.user.findUnique({ where: { id: clerkUserId } }).
    // Without this record the webmaster gets "User not found" on every authenticated request.
    await prismaClient.user.create({
      data: {
        id: response.id, // Clerk user ID — must match what req.auth.userId returns on login
        firstName: fullName.split(" ")[0],
        lastName: fullName.split(" ")[1] || "",
        email,
        password,
        role: "webmaster",
        apiKey:
          Math.random().toString(36).substring(2, 15) +
          Math.random().toString(36).substring(2, 15),
      },
    });

    // Format campaign IDs for Prisma connection
    const campaignConnections = Array.isArray(campaigns)
      ? campaigns.map((campaignId) => ({
          id: campaignId,
        }))
      : [];

    // Create webmaster with campaign connections
    // userId here is the *owner/admin* who created this webmaster
    const webmaster = await prismaClient.webmaster.create({
      data: {
        email,
        firstName: fullName.split(" ")[0],
        lastName: fullName.split(" ")[1] || "",
        password,
        userId, // The owner/admin user ID
        apiKey: response.id, // Clerk user ID of the webmaster
        // Connect to existing campaigns
        campaigns: {
          connect: campaignConnections,
        },
      },
      // Include campaigns in the response
      include: {
        campaigns: true,
      },
    });

    console.log("Webmaster created with campaigns:", webmaster.campaigns);

    res.status(201).json({
      message: "Webmaster created",
      webmaster: {
        id: webmaster.id,
        email: webmaster.email,
        name: `${webmaster.firstName} ${webmaster.lastName}`,
        campaigns: webmaster.campaigns,
      },
    });
  } catch (error) {
    console.log("error", error);
    // Extract Clerk-specific error messages when available
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
    const webmasters = await prismaClient.webmaster.findMany({
      where: {
        userId,
      },
      include: {
        campaigns: true,
      },
    });
    console.log("Webmasters found:", webmasters);
    res.status(200).json(webmasters);
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
    const currentWebmaster = await prismaClient.webmaster.findUnique({
      where: { id },
      include: { campaigns: true },
    });

    if (!currentWebmaster) {
      return res.status(404).json({ error: "Webmaster not found" });
    }

    const newCampaignIds = Array.isArray(campaigns) ? campaigns : [];

    const campaignsToConnect = newCampaignIds.filter(
      (campaignId) =>
        !currentWebmaster.campaigns.find((c) => c.id === campaignId)
    );

    const campaignsToDisconnect = currentWebmaster.campaigns
      .filter((campaign) => !newCampaignIds.includes(campaign.id))
      .map((campaign) => campaign.id);

    const webmaster = await prismaClient.webmaster.update({
      where: { id },
      data: {
        firstName,
        lastName,
        isActive,
        campaigns: {
          connect: campaignsToConnect.map((campaignId) => ({ id: campaignId })),
          disconnect: campaignsToDisconnect.map((campaignId) => ({
            id: campaignId,
          })),
        },
      },
      include: {
        campaigns: true,
      },
    });

    // update clerk user
    // the API key is the clerk user id
    if (isActive === false) {
      const clerkUser = await clerkClient.users.lockUser(webmaster.apiKey);
      console.log("clerkUser", clerkUser);
    } else {
      const clerkUser = await clerkClient.users.unlockUser(webmaster.apiKey);
      console.log("clerkUser", clerkUser);
    }

    console.log("webmaster updated", webmaster);
    res.status(200).json(webmaster);
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
    const currentWebmaster = await prismaClient.webmaster.findUnique({
      where: { id },
    });

    if (!currentWebmaster) {
      res.status(404).json({ error: "Webmaster not found" });
      return;
    }

    await prismaClient.webmaster.delete({
      where: { id },
    });

    // Also delete the corresponding User record (its id = the Clerk user ID stored in apiKey)
    await prismaClient.user.deleteMany({
      where: { id: currentWebmaster.apiKey },
    });

    await clerkClient.users.deleteUser(currentWebmaster.apiKey);

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
