import prismaClient from "../utils/prismaClient.js";
import { randomUUID } from "crypto";
import { sendWebhook } from "../utils/sendWebhook.js";
import { duplicateCutoff } from "../utils/check-duplicate-lead.js";
import getClientIp from "../utils/get-client-ip.js";
import { encodePublicOrgLeadId } from "../utils/org-lead-id.js";
import { resolveApiKeyPrincipal } from "../utils/api-key-principal.js";
import logger from "../utils/logger.js";
import { logLeadOutcome, fingerprintApiKey, phoneLast4 } from "../utils/lead-log.js";

const leadModelHasOrgLeadId =
  !!prismaClient?._runtimeDataModel?.models?.Lead?.fields?.some(
    (field) => field.name === "orgLeadId",
  );

// ----- START utility functions ------
// What lead creation needs from the campaign, whichever way it was resolved.
const LEAD_CAMPAIGN_SELECT = {
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
};

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
// With duplicateCheck ({ phone, campaignId, cutoff }), the duplicate verdict is
// made inside the same statement: the row is stored as "Duplicate" when an
// earlier lead with that phone exists in the campaign since cutoff (or ever,
// when cutoff is null). Callers read the verdict from the returned status.
const createLead = async (
  leadData,
  usageUserId,
  organizationId,
  timer,
  duplicateCheck,
) => {
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
  const statusExpression = (status) => {
    if (!duplicateCheck) {
      return bind(status, "text");
    }
    const windowClause = duplicateCheck.cutoff
      ? ` AND "createdAt" >= ${bind(duplicateCheck.cutoff, "timestamp(3)")}`
      : "";
    return `CASE WHEN EXISTS (
        SELECT 1 FROM "Lead"
        WHERE "phone" = ${bind(duplicateCheck.phone, "text")}
          AND "campaignId" = ${bind(duplicateCheck.campaignId, "text")}${windowClause}
      ) THEN 'Duplicate' ELSE ${bind(status, "text")} END`;
  };

  const leadValueParams = LEAD_INSERT_COLUMNS.map((column) =>
    column === "status"
      ? statusExpression(leadData.status ?? null)
      : bind(leadData[column] ?? null, "text"),
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

const handleDuplicateLead = (
  duplicateLead,
  principalWithCampaign,
  organizationId,
  req,
  res,
  logFields,
) => {
  // Send response immediately, handle webhook asynchronously
  const route = principalWithCampaign.campaigns[0]?.route;
  if (route?.hasWebhook) {
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

const handleNewLead = (
  lead,
  principalWithCampaign,
  organizationId,
  req,
  res,
  logFields,
) => {
  // Send response immediately, handle webhook asynchronously
  const route = principalWithCampaign.campaigns[0]?.route;
  if (route?.hasWebhook) {
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

  // The owner posts to any campaign in their organization. Advertisers and
  // publishers post only to campaigns granted to them — always, with or without
  // grants, so a member nobody has assigned yet cannot post anywhere. Anything
  // that is not the owner takes the granted path, so an unexpected role fails
  // closed.
  const organizationId = principal.organizationId;
  if (!organizationId) {
    return { ...principal, id: principal.actorUserId, usageUserId: principal.planUserId, campaigns: [] };
  }

  let campaigns;
  if (principal.role !== "owner") {
    timer?.time("db:campaignWebmaster.findFirst(grant)");
    const grant = await prismaClient.campaignWebmaster.findFirst({
      where: {
        userId: principal.actorUserId,
        campaign: { campId, organizationId },
      },
      select: { campaign: { select: LEAD_CAMPAIGN_SELECT } },
    });
    timer?.timeEnd("db:campaignWebmaster.findFirst(grant)");
    campaigns = grant ? [grant.campaign] : [];
  } else {
    timer?.time("db:campaign.findFirst(org)");
    const campaign = await prismaClient.campaign.findFirst({
      where: { campId, organizationId },
      // Oldest first: campId is not unique per organization, and this is the
      // one the owner's key resolved before keys became organization-wide.
      orderBy: { createdAt: "asc" },
      select: LEAD_CAMPAIGN_SELECT,
    });
    timer?.timeEnd("db:campaign.findFirst(org)");
    campaigns = campaign ? [campaign] : [];
  }

  return {
    ...principal,
    id: principal.actorUserId,
    usageUserId: principal.planUserId,
    campaigns,
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

  // Carried on every outcome line for this attempt, so one search by key or
  // campaign returns the whole picture. The key itself is never logged.
  const logFields = {
    src: source === "body" ? "api-post" : "api-get",
    campId,
    keyFp: fingerprintApiKey(apiKey),
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

    if (!principalWithCampaign.isActive) {
        logLeadOutcome(req, {
          ...logFields,
          outcome: "member_inactive",
          status: 403,
          actorUserId: principalWithCampaign.actorUserId,
        });
      return res.status(403).json({ error: "Account is inactive" });
    }

    if (!principalWithCampaign.organizationId) {
      logLeadOutcome(req, {
        ...logFields,
        outcome: "member_no_org",
        status: 400,
        actorUserId: principalWithCampaign.actorUserId,
      });
      return res.status(400).json({
        error: "API key must belong to an organization",
      });
    }

    const campaign = principalWithCampaign.campaigns?.[0];
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

    if (principalWithCampaign.organizationId !== organizationId) {
      logLeadOutcome(req, {
        ...logFields,
        outcome: "member_org_mismatch",
        status: 403,
        keyOrgId: principalWithCampaign.organizationId,
        campaignOrgId: organizationId,
      });
      return res.status(403).json({
        error: "API key organization does not match campaign organization",
      });
    }

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

    // The duplicate check runs inside the insert; the stored status says which
    // way it went.
    timer?.time("step:createLead");
    const lead = await createLead(
      leadData,
      principalWithCampaign.usageUserId,
      organizationId,
      timer,
      {
        phone: sanitizedPhone,
        campaignId: campaign.id,
        cutoff: duplicateCutoff(campaign.lead_period),
      },
    );
    timer?.timeEnd("step:createLead");
    timer?.timeEnd("handler:addLead");

    if (lead.status === "Duplicate") {
      return handleDuplicateLead(
        lead,
        principalWithCampaign,
        organizationId,
        req,
        res,
        { ...logFields, leadPeriod: campaign.lead_period },
      );
    }

    return handleNewLead(
      lead,
      principalWithCampaign,
      organizationId,
      req,
      res,
      logFields,
    );
  } catch (error) {
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

export { addLead, addLeadGet };
