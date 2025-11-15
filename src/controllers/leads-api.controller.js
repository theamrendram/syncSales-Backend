const prismaClient = require("../utils/prismaClient");
const { sendWebhook } = require("../utils/sendWebhook");
const { checkDuplicateLead } = require("../utils/check-duplicate-lead");
const getIpAndCountry = require("../utils/get-ip-and-country");

// ----- START utility functions ------
const createLead = async (leadData, userId) => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Use transaction for atomicity and upsert for leadUsage to prevent failures
  return await prismaClient.$transaction(async (tx) => {
    const lead = await tx.lead.create({ data: leadData });

    // Upsert ensures the record exists, preventing update failures
    await tx.leadUsage.upsert({
      where: {
        userId_date: {
          userId: userId,
          date: today,
        },
      },
      update: {
        count: {
          increment: 1,
        },
      },
      create: {
        userId: userId,
        date: today,
        count: 1,
      },
    });

    return lead;
  });
};

// Extract webhook handling to reduce duplication
const handleWebhookAsync = async (route, lead) => {
  if (!route?.hasWebhook) return;

  try {
    const webhookRes = await sendWebhook(route, lead);
    await prismaClient.lead.update({
      where: { id: lead.id },
      data: { webhookResponse: webhookRes },
    });
  } catch (error) {
    console.error("Error sending webhook:", error.message);
    // Store error in webhookResponse for debugging
    await prismaClient.lead
      .update({
        where: { id: lead.id },
        data: {
          webhookResponse: {
            error: error.message,
            timestamp: new Date().toISOString(),
          },
        },
      })
      .catch((updateError) => {
        console.error("Failed to update lead with webhook error:", updateError);
      });
  }
};

const handleDuplicateLead = async (leadData, userWithCampaign, res) => {
  const duplicateLead = await createLead(
    { ...leadData, status: "Duplicate" },
    userWithCampaign.id
  );

  // Send response immediately, handle webhook asynchronously
  const route = userWithCampaign.campaigns[0]?.route;
  if (route?.hasWebhook) {
    // Fire and forget - don't block response
    handleWebhookAsync(route, duplicateLead).catch((err) => {
      console.error("Async webhook handling failed:", err);
    });
  }

  return res
    .status(400)
    .json({ lead_id: duplicateLead.id, status: "Duplicate" });
};

const handleNewLead = async (leadData, userWithCampaign, res) => {
  const lead = await createLead(leadData, userWithCampaign.id);

  // Send response immediately, handle webhook asynchronously
  const route = userWithCampaign.campaigns[0]?.route;
  if (route?.hasWebhook) {
    // Fire and forget - don't block response
    handleWebhookAsync(route, lead).catch((err) => {
      console.error("Async webhook handling failed:", err);
    });
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
// ----- END utility functions ------

// Extract common lead processing logic
const processLeadRequest = async (req, res, source) => {
  const data = source === "body" ? req.body : req.query;
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
  } = data;

  // Validation
  if (!apiKey) {
    return res.status(400).json({ error: "Missing API key" });
  }
  if (!name || !phone || !campId) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // Sanitize and parse input
  const { ip, country } = getIpAndCountry(req);
  const nameParts = (name || "").trim().split(/\s+/);
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || null;
  const sanitizedPhone = String(phone).replace(/\D/g, "");

  if (!sanitizedPhone) {
    return res.status(400).json({ error: "Invalid phone number" });
  }

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
      firstName: firstName.trim(),
      lastName: lastName?.trim() || null,
      phone: sanitizedPhone,
      email: email?.trim() || null,
      address: address || null,
      ip,
      country,
      status: "Pending",
      sub1: sub1 || null,
      sub2: sub2 || null,
      sub3: sub3 || null,
      sub4: sub4 || null,
      campaignId: campaign.id,
      routeId: campaign.routeId,
      userId: userWithCampaign.id,
    };

    if (isDuplicate) {
      return await handleDuplicateLead(leadData, userWithCampaign, res);
    }

    return await handleNewLead(leadData, userWithCampaign, res);
  } catch (error) {
    console.error("Error processing lead:", error);
    return res.status(400).json({
      success: false,
      error: "Unable to create lead",
      details: error.message,
    });
  }
};

const addLead = async (req, res) => {
  return processLeadRequest(req, res, "body");
};

const addLeadGet = async (req, res) => {
  return processLeadRequest(req, res, "query");
};

const updateLead = async (req, res) => {
  const { id, data } = req.body;

  console.log("update lead data", id, data);
  if (!id || !data) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const updatedLead = await prismaClient.lead.update({
      where: { id },
      data,
    });

    return res.status(200).json({ success: true, lead: updatedLead });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({ error: "Lead not found" });
    }
    console.error("Error updating lead:", error);
    return res.status(500).json({ error: "Failed to update lead." });
  }
};

module.exports = {
  addLead,
  addLeadGet,
  updateLead,
};
