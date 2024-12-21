const prismaClient = require("../utils/prismaClient");
const { sendWebhook } = require("../utils/sendWebhook");
const getLeads = async (req, res) => {
  try {
    const leads = await prismaClient.lead.findMany();
    res.json(leads);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Unable to fetch leads", details: error.message });
  }
};

const addLead = async (req, res) => {
  const {
    firstName,
    lastName,
    phone,
    email,
    address,
    status,
    sub1,
    sub2,
    sub3,
    sub4,
    campId,
    apiKey,
  } = req.body;

  if (!firstName || !lastName || !phone || !apiKey || !campId) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const [user, campaign] = await Promise.all([
      prismaClient.user.findUnique({ where: { apiKey } }),
      prismaClient.campaign.findFirst({
        where: { campId },
        include: { route: true },
      }),
    ]);

    if (!user) {
      return res.status(400).json({ error: "Invalid API key" });
    }

    if (!campaign) {
      return res.status(400).json({ error: "Invalid campaign ID" });
    }

    const lead = await prismaClient.lead.create({
      data: {
        firstName,
        lastName,
        phone,
        email,
        address,
        status,
        sub1,
        sub2,
        sub3,
        sub4,
        campaignId: campaign.id,
        routeId: campaign.routeId,
        userId: user.id,
      },
    });
    console.log("Lead created", campaign);
    const webhookResponse = await sendWebhook(campaign.route, lead);
    res.status(201).json(webhookResponse);
  } catch (error) {
    console.log(error);
    res
      .status(400)
      .json({ error: "Unable to create lead", details: error.message });
  }
};

const getLeadsByUser = async (req, res) => {
  const { userId } = req.params;
  try {
    const leads = await prismaClient.lead.findMany({
      where: {
        userId,
      },
    });
    console.log("leads by user id", leads);
    res.json(leads);
  } catch (error) {
    console.log(error);
    res
      .status(400)
      .json({ error: "Unable to get leads", details: error.message });
  }
};

module.exports = {
  getLeads,
  addLead,
  getLeadsByUser,
};
