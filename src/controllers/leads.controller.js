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
    // Fetch the user details from your database (Prisma)
    const user = await prismaClient.user.findUnique({
      where: { id: userId },
      select: { role: true, companyId: true, email: true }, // Fetch role, companyId, and email
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    console.log(`User Role: ${user.role}, Company ID: ${user.companyId}`);

    if (user.role === "admin") {
      if (!user.companyId) {
        return res
          .status(400)
          .json({ error: "Company ID not found for admin" });
      }

      // Fetch all leads for the company
      const leads = await prismaClient.lead.findMany({
        where: {
          user: { companyId: user.companyId }, // Fetch leads of all users in the same company
        },
        include: {
          campaign: true,
          route: { select: { payout: true, name: true } },
        },
      });

      return res.json(leads);
    }

    if (user.role === "webmaster") {
      // Fetch the webmaster's campaigns
      const webmaster = await prismaClient.webmaster.findUnique({
        where: { email: user.email },
        select: { id: true, campaigns: { select: { id: true } } },
      });

      if (!webmaster) {
        return res.status(404).json({ error: "Webmaster not found" });
      }

      const campaignIds = webmaster.campaigns.map((c) => c.id);
      if (!campaignIds.length) return res.json([]);

      // Fetch leads associated with the webmaster's campaigns
      const leads = await prismaClient.lead.findMany({
        where: { campaignId: { in: campaignIds } },
        include: {
          campaign: true,
          route: { select: { payout: true, name: true } },
        },
      });

      return res.json(leads);
    }

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
