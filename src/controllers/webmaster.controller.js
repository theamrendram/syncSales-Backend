const { PrismaClient } = require("@prisma/client");
const { clerkClient } = require("@clerk/express");
const prismaClient = new PrismaClient();

const addWebmaster = async (req, res) => {
  const { email, password, fullName, campaigns } = await req.body;
  console.log("adding new webmaster", req.body);
  const { userId } = req.auth;
  try {
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

    // Format campaign IDs for Prisma connection
    const campaignConnections = Array.isArray(campaigns)
      ? campaigns.map((campaignId) => ({
          id: campaignId,
        }))
      : [];

    // Create webmaster with campaign connections
    const webmaster = await prismaClient.webmaster.create({
      data: {
        email,
        firstName: fullName.split(" ")[0],
        lastName: fullName.split(" ")[1] || "",
        password,
        userId, // This associates the webmaster with the user
        apiKey: response.id,
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
