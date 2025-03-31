const prismaClient = require("../utils/prismaClient");
const { sendWebhook } = require("../utils/sendWebhook");
const { checkDuplicateLead } = require("../utils/check-duplicate-lead");
const getIpAndCountry = require("../utils/get-ip-and-country");
const { clerkClient } = require("@clerk/express");

const getLeads = async (req, res) => {
  const { page = 1, items = 5 } = req.query;

  const skip = (page - 1) * items;
  const take = parseInt(items);

  try {
    const leads = await prismaClient.lead.findMany({
      include: {
        campaign: true,
      },
    });
    // console.log("leads", leads);
    res.json(leads);
  } catch (error) {
    // console.log(error);
    res.status(500).json({ error: "Unable to fetch leads", details: error });
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
  } = req.body;

  const { ip, country } = getIpAndCountry(req);

  if (!firstName || !lastName || !phone || !apiKey || !campId) {
    return res.status(400).json({ error: "Missing required fields" });
  }

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

const getLeadsByUser = async (req, res) => {
  const { userId } = req.auth;

  try {
    // Fetch user role from Clerk
    const user = await clerkClient.users.getUser(userId);
    const role = user.privateMetadata?.role || "admin";
    console.log("User Role:", role);

    if (role === "admin") {
      // Fetch all leads for an admin
      const leads = await prismaClient.lead.findMany({
        where: { userId },
        include: {
          campaign: true,
          route: { select: { payout: true, name: true } },
        },
      });

      return res.json(leads);
    }

    if (role === "webmaster") {
      // Fetch webmaster ID
      console.log("Webmaster ID:", user.emailAddresses[0].emailAddress);
      const webmaster = await prismaClient.webmaster.findUnique({
        where: { email: user.emailAddresses[0].emailAddress },
        select: { id: true, email: true, campaigns: true },
      });
      console.log("Webmaster:", webmaster);

      if (!webmaster) {
        console.log("Webmaster not found");
        return res.status(404).json({ error: "Webmaster not found" });
      }

      // Fetch campaigns associated with webmaster
      const campaigns = await prismaClient.campaign.findMany({
        where: { webmasterId: webmaster.id },
        select: { id: true },
      });
      console.log("Campaigns:", campaigns);

      if (!campaigns.length) {
        return res.json([]); // Return empty array if no campaigns
      }

      const campaignIds = campaigns.map((c) => c.id);

      // Fetch leads associated with webmaster's campaigns
      const leads = await prismaClient.lead.findMany({
        where: { campaignId: { in: campaignIds } },
        include: {
          campaign: true,
          route: { select: { payout: true } },
        },
      });

      return res.json(leads);
    }

    // If role is not recognized, return an error
    return res.status(403).json({ error: "Unauthorized role" });
  } catch (error) {
    console.error("Error fetching leads:", error);
    return res
      .status(500)
      .json({ error: "Unable to get leads", details: error.message });
  }
};

module.exports = {
  getLeads,
  addLead,
  getLeadsByUser,
};
