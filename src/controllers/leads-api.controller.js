const prismaClient = require("../utils/prismaClient");
const { randomUUID } = require("crypto");
const { sendWebhook } = require("../utils/sendWebhook");
const { checkDuplicateLead } = require("../utils/check-duplicate-lead");
const getClientIp = require("../utils/get-client-ip");
const { encodePublicOrgLeadId } = require("../utils/org-lead-id");
const { resolveApiKeyPrincipal } = require("../utils/api-key-principal");

const leadModelHasOrgLeadId =
  !!prismaClient?._runtimeDataModel?.models?.Lead?.fields?.some(
    (field) => field.name === "orgLeadId",
  );

// ----- START utility functions ------
// Columns written from leadData, in a fixed order. "date"/"createdAt" are left
// to their DB defaults; "id"/"updatedAt" have none, so they are supplied here.
const LEAD_INSERT_COLUMNS = [
  "firstName",
  "lastName",
  "phone",
  "email",
  "address",
  "status",
  "sub1",
  "sub2",
  "sub3",
  "sub4",
  "campaignId",
  "routeId",
  "userId",
  "ip",
  "country",
];

// One statement instead of an interactive transaction: BEGIN/COMMIT alone cost
// two network round trips, and each nested query cost another. A single
// data-modifying CTE is still atomic and runs in one round trip.
const createLead = async (leadData, usageUserId, organizationId, timer) => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const params = [];
  const bind = (value, cast) => {
    params.push(value);
    return `$${params.length}::${cast}`;
  };

  const orgIdParam = bind(organizationId, "text");

  // Usage tracking must never block lead creation. Folding it into this
  // statement makes it atomic, so it is only included when it cannot fail on a
  // NOT NULL violation.
  const usageCte = usageUserId
    ? `, usage AS (
      INSERT INTO "LeadUsage" ("id", "userId", "date", "count", "organizationId")
      VALUES (${bind(randomUUID(), "text")}, ${bind(usageUserId, "text")}, ${bind(
        today,
        "timestamp(3)",
      )}, 1, ${orgIdParam})
      ON CONFLICT ("userId", "date")
      DO UPDATE SET "count" = "LeadUsage"."count" + 1
    )`
    : "";

  const idParam = bind(randomUUID(), "text");
  const leadValueParams = LEAD_INSERT_COLUMNS.map((column) =>
    bind(leadData[column] ?? null, "text"),
  );
  const updatedAtParam = bind(new Date(), "timestamp(3)");

  const columns = [
    "id",
    ...LEAD_INSERT_COLUMNS,
    "organizationId",
    "updatedAt",
    ...(leadModelHasOrgLeadId ? ["orgLeadId"] : []),
  ]
    .map((column) => `"${column}"`)
    .join(", ");

  const values = [
    idParam,
    ...leadValueParams,
    orgIdParam,
    updatedAtParam,
    ...(leadModelHasOrgLeadId ? ['counter."nextValue"'] : []),
  ].join(", ");

  const sql = `
    WITH counter AS (
      INSERT INTO "OrgLeadCounter" ("organizationId", "nextValue")
      VALUES (${orgIdParam}, 1)
      ON CONFLICT ("organizationId")
      DO UPDATE SET "nextValue" = "OrgLeadCounter"."nextValue" + 1
      RETURNING "nextValue"
    )${usageCte}
    INSERT INTO "Lead" (${columns})
    SELECT ${values} FROM counter
    RETURNING *;
  `;

  // RETURNING * because sendWebhook maps arbitrary lead fields into the payload.
  timer?.time("db:createLead (single statement)");
  const rows = await prismaClient.$queryRawUnsafe(sql, ...params);
  timer?.timeEnd("db:createLead (single statement)");

  return rows[0];
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

const handleDuplicateLead = async (
  leadData,
  principalWithCampaign,
  organizationId,
  res,
  timer,
) => {
  const duplicateLead = await createLead(
    { ...leadData, status: "Duplicate" },
    principalWithCampaign.usageUserId,
    organizationId,
    timer,
  );

  // Send response immediately, handle webhook asynchronously
  const route = principalWithCampaign.campaigns[0]?.route;
  if (route?.hasWebhook) {
    // Fire and forget - don't block response
    handleWebhookAsync(route, duplicateLead).catch((err) => {
      console.error("Async webhook handling failed:", err);
    });
  }

  return res.status(400).json({
    lead_id: encodePublicOrgLeadId(duplicateLead.orgLeadId),
    status: "Duplicate",
  });
};

const handleNewLead = async (
  leadData,
  principalWithCampaign,
  organizationId,
  res,
  timer,
) => {
  const lead = await createLead(
    leadData,
    principalWithCampaign.usageUserId,
    organizationId,
    timer,
  );

  // Send response immediately, handle webhook asynchronously
  const route = principalWithCampaign.campaigns[0]?.route;
  if (route?.hasWebhook) {
    // Fire and forget - don't block response
    handleWebhookAsync(route, lead).catch((err) => {
      console.error("Async webhook handling failed:", err);
    });
  }

  return res.status(201).json({
    success: true,
    lead_id: encodePublicOrgLeadId(lead.orgLeadId),
    status: lead.status,
  });
};

const getPrincipalWithCampaign = async (
  apiKey,
  campId,
  timer,
  cachedPrincipal,
) => {
  // checkUserPlan already resolved this exact API key; reuse it instead of
  // paying the lookup twice.
  const normalizedApiKey =
    typeof apiKey === "string" ? apiKey.trim() : null;
  const principal =
    cachedPrincipal && normalizedApiKey && cachedPrincipal.apiKey === normalizedApiKey
      ? cachedPrincipal
      : await resolveApiKeyPrincipal(apiKey, timer);
  if (!principal) {
    return null;
  }

  if (principal.type === "user") {
    timer?.time("db:user.findUnique(+ownedCampaigns)");
    const userWithCampaign = await prismaClient.user.findUnique({
      relationLoadStrategy: "join",
      where: { apiKey: principal.apiKey },
      select: {
        id: true,
        ownedCampaigns: {
          where: { campId },
          select: {
            id: true,
            routeId: true,
            lead_period: true,
            organizationId: true,
            route: {
              select: {
                url: true,
                method: true,
                attributes: true,
                hasWebhook: true,
                organizationId: true,
              },
            },
          },
        },
      },
    });
    timer?.timeEnd("db:user.findUnique(+ownedCampaigns)");

    if (!userWithCampaign) {
      return null;
    }

    return {
      ...principal,
      id: userWithCampaign.id,
      usageUserId: principal.planUserId,
      campaigns: userWithCampaign.ownedCampaigns,
    };
  }

  timer?.time("db:campaign.findFirst");
  const campaign = await prismaClient.campaign.findFirst({
    relationLoadStrategy: "join",
    where: {
      campId,
      organizationId: principal.organizationId || undefined,
      webmasterMemberships: {
        some: { userId: principal.actorUserId },
      },
    },
    select: {
      id: true,
      routeId: true,
      lead_period: true,
      organizationId: true,
      route: {
        select: {
          url: true,
          method: true,
          attributes: true,
          hasWebhook: true,
          organizationId: true,
        },
      },
    },
  });
  timer?.timeEnd("db:campaign.findFirst");

  return {
    ...principal,
    id: principal.actorUserId,
    usageUserId: principal.planUserId,
    campaigns: campaign ? [campaign] : [],
    organizationId: principal.organizationId,
    isActive: principal.isActive,
  };
};

const resolveLeadOrganizationId = async (
  principalWithCampaign,
  campaign,
  timer,
) => {
  const campaignOrganizationId =
    campaign?.organizationId ?? campaign?.route?.organizationId ?? null;
  if (campaignOrganizationId) {
    return campaignOrganizationId;
  }

  if (principalWithCampaign?.organizationId) {
    return principalWithCampaign.organizationId;
  }

  if (principalWithCampaign?.type !== "user" || !principalWithCampaign?.id) {
    return null;
  }

  timer?.time("db:organizationMember.findFirst");
  const membership = await prismaClient.organizationMember.findFirst({
    where: {
      userId: principalWithCampaign.id,
      status: "active",
    },
    select: {
      organizationId: true,
    },
    orderBy: {
      joinedAt: "asc",
    },
  });
  timer?.timeEnd("db:organizationMember.findFirst");

  return membership?.organizationId ?? null;
};
// ----- END utility functions ------

// Extract common lead processing logic
const processLeadRequest = async (req, res, source) => {
  const timer = req.timer;
  timer?.time("handler:addLead");
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
  const ip = getClientIp(req);
  const country = "IN";
  const nameParts = (name || "").trim().split(/\s+/);
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || null;
  const sanitizedPhone = String(phone).replace(/\D/g, "");

  if (!sanitizedPhone) {
    return res.status(400).json({ error: "Invalid phone number" });
  }

  try {
    timer?.time("step:getPrincipalWithCampaign");
    const principalWithCampaign = await getPrincipalWithCampaign(
      apiKey,
      campId,
      timer,
      req.principal,
    );
    timer?.timeEnd("step:getPrincipalWithCampaign");
    if (!principalWithCampaign) {
      return res.status(400).json({ error: "Invalid API key" });
    }

    if (principalWithCampaign.type === "webmaster") {
      if (!principalWithCampaign.isActive) {
        return res.status(403).json({ error: "Webmaster is inactive" });
      }

      if (!principalWithCampaign.organizationId) {
        return res.status(400).json({
          error: "Webmaster API key must belong to an organization",
        });
      }
    }

    const campaign = principalWithCampaign.campaigns[0];
    if (!campaign) {
      return res.status(400).json({ error: "Invalid campaign ID" });
    }

    timer?.time("step:resolveLeadOrganizationId");
    const organizationId = await resolveLeadOrganizationId(
      principalWithCampaign,
      campaign,
      timer,
    );
    timer?.timeEnd("step:resolveLeadOrganizationId");
    if (!organizationId) {
      return res.status(400).json({
        error:
          "Campaign must be linked to an organization for lead ID assignment",
      });
    }

    if (
      principalWithCampaign.type === "webmaster" &&
      principalWithCampaign.organizationId !== organizationId
    ) {
      return res.status(403).json({
        error: "Webmaster organization does not match campaign organization",
      });
    }

    timer?.time("step:checkDuplicateLead");
    const isDuplicate = await checkDuplicateLead(
      sanitizedPhone,
      campaign,
      timer,
    );
    timer?.timeEnd("step:checkDuplicateLead");
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
      userId: principalWithCampaign.id,
    };

    if (isDuplicate) {
      timer?.time("step:handleDuplicateLead");
      const duplicateResponse = await handleDuplicateLead(
        leadData,
        principalWithCampaign,
        organizationId,
        res,
        timer,
      );
      timer?.timeEnd("step:handleDuplicateLead");
      timer?.timeEnd("handler:addLead");
      return duplicateResponse;
    }

    timer?.time("step:handleNewLead");
    const newLeadResponse = await handleNewLead(
      leadData,
      principalWithCampaign,
      organizationId,
      res,
      timer,
    );
    timer?.timeEnd("step:handleNewLead");
    timer?.timeEnd("handler:addLead");
    return newLeadResponse;
  } catch (error) {
    timer?.endAll();
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
