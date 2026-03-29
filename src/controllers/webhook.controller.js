const prismaClient = require("../utils/prismaClient");

const addWebhook = async (req, res) => {
  const { name, url, method, attributes } = req.body;
  try {
    // const webhook = await prismaClient.webhook.create({
    //   data: {
    //     name,
    //     url,
    //   },
    // });
    res.status(201).json(webhook);
  } catch (error) {
    res
      .status(400)
      .json({ error: "Unable to create webhook", details: error.message });
  }
};

const getWebhooks = async (req, res) => {
  const { userId } = req.auth;
  const ownerOrganization = await getOwnerOrganization(userId);
  if (!ownerOrganization?.id) {
    return res.status(400).json({ error: "Owner organization not found" });
  } 
  const webmasters = await prismaClient.user.findMany({
    where: {
      organizationMemberships: {
        some: {
          organizationId: ownerOrganization.id,
        },
      },
    },
    include: {
      WebmasterProfile: true,
    },
  });
  res.json(webmasters);
};

module.exports = { addWebhook, getWebhooks };