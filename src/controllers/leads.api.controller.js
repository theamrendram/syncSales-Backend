const prismaClient = require("../utils/prismaClient");
const { sendWebhook } = require("../utils/sendWebhook");
const { checkDuplicateLead } = require("../utils/check-duplicate-lead");
const getIpAndCountry = require("../utils/get-ip-and-country");

const addLead = async (req, res) => {
  const {
    name,
    phone,
    email,
    address,
    sub1,
    sub2,
    sub3,
    sub4,
    campId,
    apiKey,
  } = req.body;

  console.log("req.body", req.body);

  if (!name || !phone || !apiKey || !campId) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const { ip, country } = getIpAndCountry(req);
  const [firstName, lastName] = name.split(" ");
  try {
    const userWithCampaign = await prismaClient.user.findUnique({
      where: { apiKey },
      select: {
        id: true,
        campaigns: {
          where: {
            campId,
          },
          select: {
            id: true,
            routeId: true,
            lead_period: true,
            route: {
              select: {
                url: true,
                method: true,
                attributes: true,
              },
            },
          },
        },
      },
    });

    if (!userWithCampaign) {
      return res.status(400).json({ error: "Invalid API key" });
    }

    const campaign = userWithCampaign.campaigns[0];

    if (!campaign) {
      return res.status(400).json({ error: "Invalid campaign ID" });
    }

    const isDuplicate = await checkDuplicateLead(phone, campaign);
    console.log("duplicate lead", isDuplicate);
    if (isDuplicate) {
      const duplicateLead = await prismaClient.lead.create({
        data: {
          firstName,
          lastName,
          phone,
          email,
          address,
          ip,
          country,
          status: "Duplicate",
          sub1,
          sub2,
          sub3,
          sub4,
          campaignId: campaign.id,
          routeId: campaign.routeId,
          userId: userWithCampaign.id,
        },
      });
      return res
        .status(400)
        .json({ lead_id: duplicateLead.id, status: "Duplicate" });
    }

    const lead = await prismaClient.lead.create({
      data: {
        firstName,
        lastName,
        phone,
        email,
        address,
        ip,
        country,
        status: "Pending",
        sub1,
        sub2,
        sub3,
        sub4,
        campaignId: campaign.id,
        routeId: campaign.routeId,
        userId: userWithCampaign.id,
      },
    });

    const webhookResponse = await sendWebhook(campaign.route, lead);

    res.status(201).json({ success: true, lead_id: lead.id, status: lead.status, ...lead });
  } catch (error) {
    console.log(error);
    res
      .status(400)
      .json({ success: false, error: "Unable to create lead", details: error.message });
  }
};

const addLeadGet = async (req, res) => {
  const {
    name,
    phone,
    email,
    address,
    sub1,
    sub2,
    sub3,
    sub4,
    campId,
    apiKey,
  } = req.query;

  if (!name || !phone || !apiKey || !campId) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const { ip, country } = getIpAndCountry(req);
  const [firstName, lastName] = name.split(" ");
  try {
    const userWithCampaign = await prismaClient.user.findUnique({
      where: { apiKey },
      select: {
        id: true,
        campaigns: {
          where: {
            campId,
          },
          select: {
            id: true,
            routeId: true,
            lead_period: true,
            route: {
              select: {
                url: true,
                method: true,
                attributes: true,
              },
            },
          },
        },
      },
    });

    if (!userWithCampaign) {
      return res.status(400).json({ error: "Invalid API key" });
    }

    const campaign = userWithCampaign.campaigns[0];

    if (!campaign) {
      return res.status(400).json({ error: "Invalid campaign ID" });
    }

    const isDuplicate = await checkDuplicateLead(phone, campaign);
    console.log("duplicate lead", isDuplicate);
    if (isDuplicate) {
      const duplicateLead = await prismaClient.lead.create({
        data: {
          firstName,
          lastName,
          phone,
          email,
          address,
          ip,
          country,
          status: "Duplicate",
          sub1,
          sub2,
          sub3,
          sub4,
          campaignId: campaign.id,
          routeId: campaign.routeId,
          userId: userWithCampaign.id,
        },
      });
      return res
        .status(400)
        .json({ lead_id: duplicateLead.id, status: "Duplicate" });
    }

    const lead = await prismaClient.lead.create({
      data: {
        firstName,
        lastName,
        phone,
        email,
        address,
        ip,
        country,
        status: "Pending",
        sub1,
        sub2,
        sub3,
        sub4,
        campaignId: campaign.id,
        routeId: campaign.routeId,
        userId: userWithCampaign.id,
      },
    });

    const webhookResponse = await sendWebhook(campaign.route, lead);

    res.status(201).json({ lead_id: lead.id, ...webhookResponse });
  } catch (error) {
    console.log(error);
    res
      .status(400)
      .json({ error: "Unable to create lead", details: error.message });
  }
};

module.exports = {
  addLead,
  addLeadGet,
};
