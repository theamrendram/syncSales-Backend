const { PrismaClient } = require("@prisma/client");
const prismaClient = new PrismaClient();

const getCampaigns = async (req, res) => {
  try {
    const campaigns = await prismaClient.campaign.findMany({
      include: {
        user: true, // Include related User data
        route: true, // Include related Route data
      },
    });
    console.log(campaigns);
    res.json(campaigns);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Unable to fetch campaigns", details: error.message });
  }
};

const getCampaignById = async (req, res) => {
  const { id } = req.params;
  try {
    const campaign = await prismaClient.campaign.findUnique({
      where: {
        id,
      },
      include: {
        user: false, // Include related User data
        route: true, // Include related Route data
        seller: true, // Include related Sellers
      },
    });
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    res.json(campaign);
  } catch (error) {
    res
      .status(400)
      .json({ error: "Unable to get campaign", details: error.message });
  }
};

const addCampaign = async (req, res) => {
  const { name, campId, userId, routeId, sellerId } = req.body;

  console.log(name, userId, routeId, sellerId);

  try {
    const campaign = await prismaClient.campaign.create({
      data: {
        name,
        campId,
        userId,
        routeId,
        sellerId, // Add sellerId if provided, it's optional in the model
        // Include other fields if they exist in your Campaign model
      },
    });
    console.log("campaign response", campaign);
    res.status(201).json(campaign);
  } catch (error) {
    res
      .status(400)
      .json({ error: "Unable to create campaign", details: error.message });
  }
};

const editCampaign = async (req, res) => {
  const { id } = req.params;
  const { name, userId, routeId, sellerId } = req.body;

  try {
    const campaign = await prismaClient.campaign.update({
      where: {
        id,
      },
      data: {
        name,
        userId,
        routeId,
        sellerId, // Update sellerId if needed
      },
    });
    res.json(campaign);
  } catch (error) {
    res
      .status(400)
      .json({ error: "Unable to update campaign", details: error.message });
  }
};

const deleteCampaign = async (req, res) => {
  const { id } = req.params;
  try {
    const campaign = await prismaClient.campaign.delete({
      where: {
        id,
      },
    });
    res.json(campaign);
  } catch (error) {
    res
      .status(400)
      .json({ error: "Unable to delete campaign", details: error.message });
  }
};
module.exports = {
  getCampaigns,
  getCampaignById,
  addCampaign,
  editCampaign,
  deleteCampaign,
};
