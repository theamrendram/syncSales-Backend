import prismaClient from "../utils/core/prismaClient.js";

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
  // Was "the organization's webmasters, with their profiles". There is no profile
  // table now, and the attributes it held sit on User.
  const members = await prismaClient.user.findMany({
    where: {
      organizationMemberships: {
        some: {
          organizationId: ownerOrganization.id,
        },
      },
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      isActive: true,
      leadLimit: true,
      payout: true,
    },
  });
  res.json(members);
};

export { addWebhook, getWebhooks };