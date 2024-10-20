const { PrismaClient } = require("@prisma/client");

const prismaClient = new PrismaClient();

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
  const webhooks = await prismaClient.webhook.findMany();
  res.json(webhooks);
};

module.exports = { addWebhook, getWebhooks };