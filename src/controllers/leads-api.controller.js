const prismaClient = require("../utils/prismaClient");
const { randomUUID } = require("crypto");
const { sendWebhook } = require("../utils/sendWebhook");
const { checkDuplicateLead } = require("../utils/check-duplicate-lead");
const getClientIp = require("../utils/get-client-ip");
const { encodePublicOrgLeadId } = require("../utils/org-lead-id");
const { resolveApiKeyPrincipal } = require("../utils/api-key-principal");
const logger = require("../utils/logger");
const {
  logLeadOutcome,
  fingerprintApiKey,
  phoneLast4,
} = require("../utils/lead-log");
const {
  isDatabaseUnavailable,
  sendDatabaseUnavailable,
} = require("../utils/db-errors");

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
//
// receivedAt (replay only) backdates "date"/"createdAt" and the usage row.
const createLead = async (
  leadData,
  usageUserId,
  organizationId,
  timer,
  receivedAt,
) => {
  const today = receivedAt ? new Date(receivedAt) : new Date();
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
  const receivedAtParams = receivedAt
    ? [bind(receivedAt, "timestamp(3)"), bind(receivedAt, "timestamp(3)")]
    : [];

  const columns = [
    "id",
    ...LEAD_INSERT_COLUMNS,
    "organizationId",
    "updatedAt",
    ...(receivedAt ? ["date", "createdAt"] : []),
    ...(leadModelHasOrgLeadId ? ["orgLeadId"] : []),
  ]
    .map((column) => `"${column}"`)
    .join(", ");

  const values = [
    idParam,
    ...leadValueParams,
    orgIdParam,
    updatedAtParam,
    ...receivedAtParams,
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
const handleWebhookAsync = async (route, lead, log) => {
  if (!route?.hasWebhook) return;

  try {
    // sendWebhook emits the lead_webhook line for both outcomes; it is the only
    // place that knows the HTTP status and the downstream verdict.
    const webhookRes = await sendWebhook(route, lead, log);
    await prismaClient.lead.update({
      where: { id: lead.id },
      data: { webhookResponse: webhookRes },
    });
  } catch (error) {
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
        (log || logger).error(
          {
            evt: "lead_webhook",
            leadId: lead.id,
            orgLeadId: lead.orgLeadId,
            err: updateError,
          },
          "lead_webhook:persist_failed",
        );
      });
  }
};

const handleDuplicateLead = async (
  leadData,
  principalWithCampaign,
  organizationId,
  req,
  res,
  timer,
  logFields,
  options = {},
) => {
  const duplicateLead = await createLead(
    { ...leadData, status: "Duplicate" },
    principalWithCampaign.usageUserId,
    organizationId,
    timer,
    options.receivedAt,
  );

  // Send response immediately, handle webhook asynchronously
  const route = principalWithCampaign.campaigns[0]?.route;
  if (route?.hasWebhook && !options.skipWebhook) {
    // Fire and forget - don't block response
    handleWebhookAsync(route, duplicateLead, req.log).catch((err) => {
      (req.log || logger).error(
        { evt: "lead_webhook", leadId: duplicateLead.id, err },
        "lead_webhook:unhandled",
      );
    });
  }

  logLeadOutcome(req, {
    ...logFields,
    outcome: "duplicate",
    status: 400,
    leadId: duplicateLead.id,
    orgLeadId: duplicateLead.orgLeadId,
    campaignId: duplicateLead.campaignId,
    routeId: duplicateLead.routeId,
    organizationId,
    hasWebhook: !!route?.hasWebhook,
  });

  return res.status(400).json({
    lead_id: encodePublicOrgLeadId(duplicateLead.orgLeadId),
    status: "Duplicate",
  });
};

const handleNewLead = async (
  leadData,
  principalWithCampaign,
  organizationId,
  req,
  res,
  timer,
  logFields,
  options = {},
) => {
  const lead = await createLead(
    leadData,
    principalWithCampaign.usageUserId,
    organizationId,
    timer,
    options.receivedAt,
  );

  // Send response immediately, handle webhook asynchronously
  const route = principalWithCampaign.campaigns[0]?.route;
  if (route?.hasWebhook && !options.skipWebhook) {
    // Fire and forget - don't block response
    handleWebhookAsync(route, lead, req.log).catch((err) => {
      (req.log || logger).error(
        { evt: "lead_webhook", leadId: lead.id, err },
        "lead_webhook:unhandled",
      );
    });
  }

  logLeadOutcome(req, {
    ...logFields,
    outcome: "created",
    status: 201,
    leadId: lead.id,
    orgLeadId: lead.orgLeadId,
    campaignId: lead.campaignId,
    routeId: lead.routeId,
    organizationId,
    hasWebhook: !!route?.hasWebhook,
  });

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

// Extract common lead processing logic. `options` comes from replayLead only.
const processLeadRequest = async (req, res, source, options = {}) => {
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

  // Carried on every outcome line for this attempt, so one search by key or
  // campaign returns the whole picture. The key itself is never logged.
  const logFields = {
    src: options.receivedAt ? "replay" : source === "body" ? "api-post" : "api-get",
    campId,
    keyFp: fingerprintApiKey(apiKey),
    ...(options.receivedAt ? { receivedAt: options.receivedAt.toISOString() } : {}),
  };

  // Validation
  if (!apiKey) {
    logLeadOutcome(req, {
      ...logFields,
      outcome: "missing_api_key",
      status: 400,
    });
    return res.status(400).json({ error: "Missing API key" });
  }
  if (!name || !phone || !campId) {
    logLeadOutcome(req, {
      ...logFields,
      outcome: "missing_required_fields",
      status: 400,
      // Field names only: the values are the customer's own details.
      missing: ["name", "phone", "campId"].filter((field) => !data[field]),
    });
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
    logLeadOutcome(req, {
      ...logFields,
      outcome: "invalid_phone",
      status: 400,
    });
    return res.status(400).json({ error: "Invalid phone number" });
  }

  logFields.phoneLast4 = phoneLast4(sanitizedPhone);

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
      logLeadOutcome(req, {
        ...logFields,
        outcome: "invalid_api_key",
        status: 400,
      });
      return res.status(400).json({ error: "Invalid API key" });
    }

    logFields.principalType = principalWithCampaign.type;

    if (principalWithCampaign.type === "webmaster") {
      if (!principalWithCampaign.isActive) {
        logLeadOutcome(req, {
          ...logFields,
          outcome: "webmaster_inactive",
          status: 403,
          actorUserId: principalWithCampaign.actorUserId,
        });
        return res.status(403).json({ error: "Webmaster is inactive" });
      }

      if (!principalWithCampaign.organizationId) {
        logLeadOutcome(req, {
          ...logFields,
          outcome: "webmaster_no_org",
          status: 400,
          actorUserId: principalWithCampaign.actorUserId,
        });
        return res.status(400).json({
          error: "Webmaster API key must belong to an organization",
        });
      }
    }

    const campaign = principalWithCampaign.campaigns[0];
    if (!campaign) {
      logLeadOutcome(req, {
        ...logFields,
        outcome: "invalid_campaign",
        status: 400,
      });
      return res.status(400).json({ error: "Invalid campaign ID" });
    }

    logFields.campaignId = campaign.id;
    logFields.routeId = campaign.routeId;

    timer?.time("step:resolveLeadOrganizationId");
    const organizationId = await resolveLeadOrganizationId(
      principalWithCampaign,
      campaign,
      timer,
    );
    timer?.timeEnd("step:resolveLeadOrganizationId");
    if (!organizationId) {
      logLeadOutcome(req, {
        ...logFields,
        outcome: "org_unresolved",
        status: 400,
      });
      return res.status(400).json({
        error:
          "Campaign must be linked to an organization for lead ID assignment",
      });
    }

    if (
      principalWithCampaign.type === "webmaster" &&
      principalWithCampaign.organizationId !== organizationId
    ) {
      logLeadOutcome(req, {
        ...logFields,
        outcome: "webmaster_org_mismatch",
        status: 403,
        keyOrgId: principalWithCampaign.organizationId,
        campaignOrgId: organizationId,
      });
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
        req,
        res,
        timer,
        { ...logFields, leadPeriod: campaign.lead_period },
        options,
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
      req,
      res,
      timer,
      logFields,
      options,
    );
    timer?.timeEnd("step:handleNewLead");
    timer?.timeEnd("handler:addLead");
    return newLeadResponse;
  } catch (error) {
    // Database down: 503 so the sender retries instead of dropping the lead.
    if (isDatabaseUnavailable(error)) {
      logLeadOutcome(req, {
        ...logFields,
        outcome: "db_unavailable",
        status: 503,
        err: error,
      });
      return sendDatabaseUnavailable(req, res);
    }
    // The response is a 400 for the caller, but reaching here is a server-side
    // failure, so it is logged at error level.
    logLeadOutcome(req, {
      ...logFields,
      outcome: "error",
      status: 400,
      level: "error",
      err: error,
    });
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

// Re-runs a payload recovered from the logs (scripts/replay-leads-from-logs.js)
// through the normal ingestion path, keeping its original arrival time.
// Returns { status, body } instead of writing to a socket.
const replayLead = async ({ body, receivedAt, reqId, ip, log, skipWebhook }) => {
  const req = {
    id: reqId,
    body,
    query: {},
    headers: ip ? { "x-forwarded-for": ip } : {},
    log,
    timer: undefined,
    principal: undefined,
  };
  const result = {};
  const res = {
    status(code) {
      result.status = code;
      return this;
    },
    json(payload) {
      result.body = payload;
      return this;
    },
    setHeader() {
      return this;
    },
  };

  await processLeadRequest(req, res, "body", {
    receivedAt: receivedAt ? new Date(receivedAt) : undefined,
    skipWebhook: !!skipWebhook,
  });
  return result;
};

const updateLead = async (req, res) => {
  const { id, data } = req.body;

  // Field names only; the values are the lead's own contact details.
  req.log?.info(
    { evt: "lead_update", leadId: id, fields: data ? Object.keys(data) : [] },
    "lead_update:received",
  );
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
    (req.log || logger).error(
      { evt: "lead_update", leadId: id, err: error },
      "lead_update:failed",
    );
    return res.status(500).json({ error: "Failed to update lead." });
  }
};

module.exports = {
  addLead,
  addLeadGet,
  replayLead,
  updateLead,
};
