const prismaClient = require("../utils/prismaClient");
const { sendWebhook } = require("../utils/sendWebhook");
const { checkDuplicateLead } = require("../utils/check-duplicate-lead");
const getIpAndCountry = require("../utils/get-ip-and-country");

const createLead = async (leadData) => {
  return await prismaClient.lead.create({ data: leadData });
};

const handleDuplicateLead = async (leadData, res) => {
  const duplicateLead = await createLead({ ...leadData, status: "Duplicate" });
  return res
    .status(400)
    .json({ lead_id: duplicateLead.id, status: "Duplicate" });
};

const handleNewLead = async (leadData, userWithCampaign, res) => {
  const lead = await createLead(leadData);
  if (!lead) {
    return res.status(400).json({ error: "Unable to create lead" });
  }

  if (userWithCampaign.campaigns[0].route.hasWebhook) {
    const webhookRes = await sendWebhook(
      userWithCampaign.campaigns[0].route,
      lead
    );

    console.log("webhook response", webhookRes)
    if (webhookRes.error) {
      console.log("Error sending webhook:", webhookRes.error);
    }
    const updateLead = await prismaClient.lead.update({
      where: {
        id: lead.id,
      },
      data: {
        webhookResponse: webhookRes,
      },
    });

    console.log("updated lead", updateLead);
  }
  return res
    .status(201)
    .json({ success: true, lead_id: lead.id, status: lead.status });
};

const getUserWithCampaign = async (apiKey, campId) => {
  return await prismaClient.user.findUnique({
    where: { apiKey },
    select: {
      id: true,
      campaigns: {
        where: { campId },
        select: {
          id: true,
          routeId: true,
          lead_period: true,
          route: {
            select: {
              url: true,
              method: true,
              attributes: true,
              hasWebhook: true,
            },
          },
        },
      },
    },
  });
};

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

  if (!apiKey) {
    return res.status(400).json({ error: "Missing API key" });
  }
  if (!name || !phone || !campId) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const { ip, country } = getIpAndCountry(req);
  const [firstName, lastName] = name.split(" ");
  const sanitizedPhone = String(phone).replace(/\D/g, "");

  try {
    const userWithCampaign = await getUserWithCampaign(apiKey, campId);
    console.log(userWithCampaign.campaigns);
    if (!userWithCampaign) {
      return res.status(400).json({ error: "Invalid API key" });
    }

    const campaign = userWithCampaign.campaigns[0];
    if (!campaign) {
      return res.status(400).json({ error: "Invalid campaign ID" });
    }

    const isDuplicate = await checkDuplicateLead(sanitizedPhone, campaign);
    const leadData = {
      firstName,
      lastName,
      phone: sanitizedPhone,
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
    };

    if (isDuplicate) {
      return await handleDuplicateLead(leadData, res);
    }

    return await handleNewLead(leadData, userWithCampaign, res);
  } catch (error) {
    console.log(error);
    return res.status(400).json({
      success: false,
      error: "Unable to create lead",
      details: error.message,
    });
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
  const sanitizedPhone = String(phone).replace(/\D/g, "");

  try {
    const userWithCampaign = await getUserWithCampaign(apiKey, campId);
    if (!userWithCampaign) {
      return res.status(400).json({ error: "Invalid API key" });
    }

    const campaign = userWithCampaign.campaigns[0];
    if (!campaign) {
      return res.status(400).json({ error: "Invalid campaign ID" });
    }

    const isDuplicate = await checkDuplicateLead(sanitizedPhone, campaign);
    const leadData = {
      firstName,
      lastName,
      phone: sanitizedPhone,
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
    };

    if (isDuplicate) {
      return await handleDuplicateLead(leadData, res);
    }

    return await handleNewLead(leadData, userWithCampaign, res);
  } catch (error) {
    console.log(error);
    return res
      .status(400)
      .json({ error: "Unable to create lead", details: error.message });
  }
};

module.exports = {
  addLead,
  addLeadGet,
};
