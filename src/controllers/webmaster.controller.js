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
  } catch {
    res.status(400).json({ error: "Unable to get webmasters" });
  }
};

module.exports = { addWebmaster, getWebmastersByUser };
