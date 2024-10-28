const { PrismaClient } = require("@prisma/client");
const prismaClient = new PrismaClient();

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
    sub1,
    sub2,
    sub3,
    sub4,
    campId,
    apiKey,
    userId,
  } = req.body;

  console.log("body", req.body);
  try {
    console.log("apiKey", apiKey);
    const seller = await prismaClient.seller.findUnique({
      where: {
        apiKey,
      },
    });
    if (!seller) {
      throw new Error("Invalid API key");
    }

    const { id: sellerId } = seller;
    const campaign = await prismaClient.campaign.findFirst({
      where: {
        sellerId,
        campId,
      },
    });

    if (!campaign) {
      throw new Error("Invalid campaign ID");
    }

    const lead = await prismaClient.lead.create({
      data: {
        firstName,
        lastName,
        phone,
        email,
        address,
        status: "pending", // Explicitly set status to pending if that's the initial status
        sub1,
        sub2,
        sub3,
        sub4,
        campaignId: campaign.id, // Corrected to match the model field name
        routeId: campaign.routeId, // Retrieved from campaign
        userId: campaign.userId, // Set userId as required by the Lead model
      },
    });
    res.status(201).json(lead);
  } catch (error) {
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
    res.json(leads);
  } catch (error) {
    res
      .status(400)
      .json({ error: "Unable to get leads", details: error.message });
  }
};

module.exports = {
  getLeads,
  addLead,
  getLeadsByUser
};
