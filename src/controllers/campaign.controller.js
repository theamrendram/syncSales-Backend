const prismaClient = require("../utils/prismaClient");

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

const getCampaignsByUser = async (req, res) => {
  const { userId } = req.params;
  console.log(userId);
  try {
    const campaigns = await prismaClient.campaign.findMany({
      where: {
        userId,
        isArchived: false,
      },
      include: {
        user: true, // Include related User data
        route: true, // Include related Route data
      },
    });
    res.json(campaigns);
  } catch (error) {
    res
      .status(400)
      .json({ error: "Unable to get campaigns", details: error.message });
  }
};

const getCampaignById = async (req, res) => {
  const { id } = req.params;
  console.log("id", id);
  try {
    const campaign = await prismaClient.campaign.findUnique({
      where: {
        id,
        isArchived: false,
      },
      include: {
        user: false, // Include related User data
        route: true, // Include related Route data
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
  const { name, campId, manager, userId, routeId, lead_period } = req.body;

  console.log("adding new campaign", req.body);
  try {
    const campaign = await prismaClient.campaign.create({
      data: {
        name,
        campId,
        userId,
        routeId,
        manager,
        lead_period: Number(lead_period),
      },
    });
    console.log(campaign);
    res.status(201).json(campaign);
  } catch (error) {
    console.log(error);
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

  console.log("id at delete campaign", id);
  try {
    const campaign = await prismaClient.campaign.update({
      where: {
        id,
      },
      data: {
        isArchived: true,
        updatedAt: new Date(),
      },
    });
    console.log("campaign at delete campaign", campaign);
    res.json({
      success: true,
      message: "Campaign archived successfully",
      data: campaign.id,
    });
  } catch (error) {
    console.log("error at delete campaign", error);
    res
      .status(400)
      .json({ error: "Unable to archive campaign", details: error.message, success: false });
  }
};
module.exports = {
  getCampaigns,
  getCampaignById,
  getCampaignsByUser,
  addCampaign,
  editCampaign,
  deleteCampaign,
};
