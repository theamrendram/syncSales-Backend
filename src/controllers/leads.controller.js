const { PrismaClient } = require("@prisma/client");
const prismaClient = new PrismaClient();

const getLeads = async (req, res) => {
  const leads = await prismaClient.lead.findMany();
  res.json(leads);
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

  console.log("body", req.body);
  try {
    const user = await prismaClient.user.findUnique({
      where: {
        apiKey,
      },
    });
    if (!user) {
      throw new Error("Invalid API key");
    }

    console.log("user", user);
    const camp = await prismaClient.campaign.findFirst({
      where: {
        campId,
        userId: user.id,
      },
    });
    if (!camp) {
      throw new Error("Campaign not found");
    }
    console.log("camp", camp);
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
        campaignId: camp.id,
        routeId: camp.routeId,
        userId: user.id,
      },
    });
    console.log(lead);
    res.status(201).json(lead);
  } catch (error) {
    res.status(400).json({ error: error.message });
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
