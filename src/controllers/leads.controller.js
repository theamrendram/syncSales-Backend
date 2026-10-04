import prismaClient from "../utils/prismaClient.js";
import { sendWebhook } from "../utils/sendWebhook.js";
import { checkDuplicateLead } from "../utils/check-duplicate-lead.js";
import getClientIp from "../utils/get-client-ip.js";
import { chartMetrics, generateExtendedReport, transformLeadsToChartData, getLeadsGroupedByDateRouteCampaign } from "../utils/chart-functions.js";
import logger from "../utils/logger.js";
import { logLeadOutcome, fingerprintApiKey, phoneLast4 } from "../utils/lead-log.js";
import { Parser } from "json2csv";
import { resolveLeadScope } from "../utils/lead-scope.js";
import { findInScope, scopeFor } from "../utils/scope.js";
import { LEAD_STATUSES, normalizeLeadStatus } from "../utils/lead-status.js";
import { isKeyRole } from "../lib/org-roles.js";
import {
  getGrantedLeadScope,
  hasResourceGrants,
} from "../utils/resource-grants.js";

const MAX_PAGE_LIMIT = 100;
const MAX_EXPORT_LIMIT = 1000;
const leadModelHasOrgLeadId =
  !!prismaClient?._runtimeDataModel?.models?.Lead?.fields?.some(
    (field) => field.name === "orgLeadId",
  );

const leadListSelect = {
  id: true,
  firstName: true,
  lastName: true,
  phone: true,
  email: true,
  status: true,
  userId: true,
  date: true,
  routeId: true,
  campaignId: true,
  webhookResponse: true,
  createdAt: true,
  updatedAt: true,
  organizationId: true,
  campaign: { select: { id: true, name: true } },
  route: { select: { payout: true, name: true } },
};

const getUserWithMemberships = async (userId) =>
  prismaClient.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      organizationMemberships: {
          select: {
          organizationId: true,
          role: true,
        },
      },
    },
  });

/**
 * Lead access for the list/export endpoints that predate withScope().
 *
 * Delegates each organization to scopeFor() in src/utils/scope.js, so these
 * endpoints narrow exactly as the scoped ones do — including advertisers and
 * publishers, who see nothing until something is assigned. With no
 * organization, it is the union of the caller's organizations, each scoped.
 */
const getLeadAccessWhereForUser = async (user, organizationId) => {
  const roleByOrg = new Map(
    user.organizationMemberships.map((m) => [m.organizationId, m.role]),
  );

  let orgIds;
  if (organizationId) {
    if (!roleByOrg.has(organizationId)) {
      const org = await prismaClient.organization.findUnique({
        where: { id: organizationId },
        select: { ownerId: true },
      });
      if (!org || org.ownerId !== user.id) {
        return { where: null, isForbidden: true };
      }
    }
    orgIds = [organizationId];
  } else {
    const ownedOrgs = await prismaClient.organization.findMany({
      where: { ownerId: user.id },
      select: { id: true },
    });
    orgIds = [...new Set([...roleByOrg.keys(), ...ownedOrgs.map((o) => o.id)])];
  }

  const scopes = await Promise.all(
    orgIds.map((orgId) =>
      scopeFor({
        userId: user.id,
        organizationId: orgId,
        role: roleByOrg.get(orgId) ?? null,
        resource: "lead",
      }),
    ),
  );
  const wheres = scopes.filter((sc) => sc.ok && !sc.empty).map((sc) => sc.where);

  if (!wheres.length) {
    return { where: null, isEmpty: true };
  }
  return {
    where: wheres.length === 1 ? wheres[0] : { OR: wheres },
    isEmpty: false,
  };
};

const getLeads = async (req, res) => {
  try {
    const ctx = req.authContext;
    if (!ctx?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const {
      page = 1,
      limit = 10,
      search,
      status,
      campaignIds,
      from,
      to,
      organizationId: queryOrganizationId,
    } = req.query;

    if (
      queryOrganizationId != null &&
      String(queryOrganizationId).trim() !== ""
    ) {
      if (
        !ctx.organizationId ||
        String(queryOrganizationId) !== ctx.organizationId
      ) {
        return res.status(403).json({ error: "Forbidden" });
      }
    }

    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
    const take = Math.min(
      Math.max(parseInt(limit, 10) || 10, 1),
      MAX_PAGE_LIMIT,
    );
    const skip = (pageNumber - 1) * take;

    // The shared resolver decides which leads this member may see; a member with
    // explicit grants is narrowed to them, everyone else to their organization.
    const scope = await resolveLeadScope(req);
    if (!scope.ok) {
      return res.status(scope.status).json({ error: scope.error });
    }
    if (scope.empty) {
      return res.json({ leads: [], total: 0, page: pageNumber, limit: take });
    }
    const scopeWhere = scope.where;

    // Filters sit beside the scope under AND, never spread into it: the
    // search's OR would otherwise replace the scope's own OR (the grant
    // narrowing) and return every lead in the organization.
    const filters = {
      ...(search && {
        OR: [
          { firstName: { contains: search, mode: "insensitive" } },
          { lastName: { contains: search, mode: "insensitive" } },
          { phone: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
        ],
      }),
      ...(status &&
        status !== "all" && {
          status: { equals: status, mode: "insensitive" },
        }),
      ...(campaignIds && {
        campaignId: {
          in: campaignIds
            .split(",")
            .map((id) => String(id).trim())
            .filter(Boolean),
        },
      }),
      ...(from &&
        to && {
          createdAt: {
            gte: new Date(from),
            lte: new Date(to),
          },
        }),
    };
    const where = { AND: [scopeWhere, filters] };

    // Get total count for pagination
    const total = await prismaClient.lead.count({ where });

    // Get leads with pagination and filters
    const leads = await prismaClient.lead.findMany({
      where,
      include: {
        campaign: true,
        route: { select: { payout: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });

    res.json({
      leads,
      total,
      page: pageNumber,
      limit: take,
    });
  } catch (error) {
    logger.error({ err: error }, "Error fetching leads");
    res.status(500).json({
      error: "Unable to fetch leads",
      details: error.message,
    });
  }
};

const addLead = async (req, res) => {
  try {
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

    // Same outcome vocabulary as the public ingestion path, tagged with its own
    // source so the two can be told apart.
    const logFields = {
      src: "dashboard",
      campId,
      keyFp: fingerprintApiKey(apiKey),
      phoneLast4: phoneLast4(phone),
    };

    // Validate required fields
    if (!firstName || !lastName || !phone || !apiKey || !campId) {
      logLeadOutcome(req, {
        ...logFields,
        outcome: "missing_required_fields",
        status: 400,
        missing: ["firstName", "lastName", "phone", "apiKey", "campId"].filter(
          (field) => !req.body[field],
        ),
      });
      return res.status(400).json({
        error: "Missing required fields",
        required: ["firstName", "lastName", "phone", "apiKey", "campId"],
      });
    }

    const ip = getClientIp(req);
    const country = "IN";

    // Get user and campaign in a single query with organization context
    const userWithCampaign = await prismaClient.user.findUnique({
      where: { apiKey },
      select: {
        id: true,
        isActive: true,
        ownedOrganization: { select: { id: true } },
        organizationMemberships: {
              select: {
            organizationId: true,
            role: true,
          },
        },
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
                organizationId: true,
              },
            },
          },
        },
        campaignGrants: {
          where: {
            campaign: { campId },
          },
          select: {
            campaign: {
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
                    organizationId: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!userWithCampaign) {
      logLeadOutcome(req, {
        ...logFields,
        outcome: "invalid_api_key",
        status: 400,
      });
      return res.status(400).json({ error: "Invalid API key" });
    }

    const campaign =
      userWithCampaign.ownedCampaigns[0] ||
      userWithCampaign.campaignGrants[0]?.campaign;
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
    logFields.organizationId = campaign.organizationId;

    if (!userWithCampaign.isActive) {
      logLeadOutcome(req, {
        ...logFields,
        outcome: "member_inactive",
        status: 403,
        actorUserId: userWithCampaign.id,
      });
      return res.status(403).json({ error: "Account is inactive" });
    }

    // A member with campaign grants must have one for this campaign. A member
    // with none is checked against the organization instead, below.
    const hasGrants = await hasResourceGrants(
      userWithCampaign.id,
      campaign.organizationId,
    );
    if (hasGrants) {
      if (!userWithCampaign.campaignGrants[0]) {
        logLeadOutcome(req, {
          ...logFields,
          outcome: "campaign_access_denied",
          status: 403,
          actorUserId: userWithCampaign.id,
        });
        return res
          .status(403)
          .json({ error: "Access denied to this campaign" });
      }
    } else {
      const userMembership = userWithCampaign.organizationMemberships.find(
        (membership) => membership.organizationId === campaign.organizationId,
      );

      if (!userMembership) {
        logLeadOutcome(req, {
          ...logFields,
          outcome: "org_access_denied",
          status: 403,
          actorUserId: userWithCampaign.id,
        });
        return res
          .status(403)
          .json({ error: "Access denied to this organization" });
      }
    }

    // Only owners, admins and publishers hold usable keys. An advertiser or
    // manager may still have a key from before roles decided this; refuse it.
    const keyRole = userWithCampaign.organizationMemberships.find(
      (membership) => membership.organizationId === campaign.organizationId,
    )?.role;
    const isOrgOwnerKey =
      userWithCampaign.ownedOrganization?.id === campaign.organizationId;
    if (!isOrgOwnerKey && !isKeyRole(keyRole)) {
      logLeadOutcome(req, {
        ...logFields,
        outcome: "key_role_denied",
        status: 403,
        actorUserId: userWithCampaign.id,
      });
      return res.status(403).json({ error: "This API key cannot send leads" });
    }

    // Check for duplicate lead
    const isDuplicate = await checkDuplicateLead(phone, campaign);
    const organizationId = campaign.organizationId;

    const createLeadWithOrgCounter = async (leadCreateData) => {
      if (!organizationId) {
        return prismaClient.lead.create({ data: leadCreateData });
      }
      return prismaClient.$transaction(async (tx) => {
        const counterRows = await tx.$queryRaw`
          INSERT INTO "OrgLeadCounter" ("organizationId", "nextValue")
          VALUES (${organizationId}, 1)
          ON CONFLICT ("organizationId")
          DO UPDATE SET "nextValue" = "OrgLeadCounter"."nextValue" + 1
          RETURNING "nextValue";
        `;
        const orgLeadId = Number(counterRows?.[0]?.nextValue || 1);

        return tx.lead.create({
          data: {
            ...leadCreateData,
            organizationId,
            ...(leadModelHasOrgLeadId ? { orgLeadId } : {}),
          },
        });
      });
    };

    if (isDuplicate) {
      const duplicateLead = await createLeadWithOrgCounter({
        firstName,
        lastName,
        phone,
        email,
        address,
        ip,
        country,
        sub1,
        sub2,
        sub3,
        sub4,
        status: "duplicate",
        userId: userWithCampaign.id,
        routeId: campaign.routeId,
        campaignId: campaign.id,
      });

      logLeadOutcome(req, {
        ...logFields,
        outcome: "duplicate",
        status: 200,
        leadId: duplicateLead.id,
        orgLeadId: duplicateLead.orgLeadId,
        leadPeriod: campaign.lead_period,
      });

      return res.json({
        success: false,
        message: "Duplicate lead detected",
        lead: duplicateLead,
      });
    }

    // Create new lead
    const newLead = await createLeadWithOrgCounter({
      firstName,
      lastName,
      phone,
      email,
      address,
      ip,
      country,
      sub1,
      sub2,
      sub3,
      sub4,
      status: "new",
      userId: userWithCampaign.id,
      routeId: campaign.routeId,
      campaignId: campaign.id,
    });

    // Send webhook if configured
    if (campaign.route?.url && campaign.route?.method) {
      try {
        const webhookResponse = await sendWebhook(
          campaign.route,
          newLead,
          req.log,
        );

        // Update lead with webhook response
        await prismaClient.lead.update({
          where: { id: newLead.id },
          data: { webhookResponse },
        });
      } catch (webhookError) {
        // sendWebhook has already logged the call with its status and the
        // downstream verdict; the lead itself is still considered created.
        // Continue even if webhook fails
      }
    }

    logLeadOutcome(req, {
      ...logFields,
      outcome: "created",
      status: 200,
      leadId: newLead.id,
      orgLeadId: newLead.orgLeadId,
      hasWebhook: !!(campaign.route?.url && campaign.route?.method),
    });

    res.json({
      success: true,
      message: "Lead added successfully",
      lead: newLead,
    });
  } catch (error) {
    logLeadOutcome(req, {
      src: "dashboard",
      outcome: "error",
      status: 500,
      err: error,
    });
    res.status(500).json({
      error: "Unable to add lead",
      details: error.message,
    });
  }
};

const getLeadsByUser = async (req, res) => {
  try {
    const { userId } = req.auth;
    const ctx = req.authContext;
    const { organizationId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "User ID not found" });
    }

    const requestedOrg =
      organizationId != null && String(organizationId).trim() !== ""
        ? String(organizationId)
        : null;
    const resolvedOrg = requestedOrg ?? ctx?.organizationId;
    if (requestedOrg && ctx?.organizationId && requestedOrg !== ctx.organizationId) {
      return res.status(403).json({
        error: "Access denied. You are not a member of this organization.",
      });
    }

    const user = await getUserWithMemberships(userId);

    if (!user) return res.status(404).json({ error: "User not found" });

    const access = await getLeadAccessWhereForUser(user, resolvedOrg);
    if (access.isForbidden) {
      return res.status(403).json({
        error: "Access denied. You are not a member of this organization.",
      });
    }
    if (access.isEmpty) {
      return res.json([]);
    }

    const exportLimit = Math.min(
      Math.max(Number(req.query.limit) || 200, 1),
      MAX_EXPORT_LIMIT,
    );
    const leads = await prismaClient.lead.findMany({
      where: access.where,
      select: leadListSelect,
      orderBy: { createdAt: "desc" },
      take: exportLimit,
    });
    res.status(200).json(leads);
  } catch (error) {
    logger.error({ err: error }, "Error fetching user leads");
    res
      .status(500)
      .json({ error: "Unable to get leads", details: error.message });
  }
};

const getLeadsByUserPagination = async (req, res) => {
  const {
    search = "",
    page = 1,
    limit = 10,
    status = "all",
    campaignIds,
    from,
    to,
    organizationId,
  } = req.query;
  const pageNumber = Math.max(Number(page) || 1, 1);
  const take = Math.min(Math.max(Number(limit) || 10, 1), MAX_PAGE_LIMIT);
  const skip = (pageNumber - 1) * take;

  try {
    const { userId } = req.auth;
    const ctx = req.authContext;
    if (!userId) return res.status(400).json({ error: "User ID not found" });

    const requestedOrg =
      organizationId != null && String(organizationId).trim() !== ""
        ? String(organizationId)
        : null;
    const resolvedOrg = requestedOrg ?? ctx?.organizationId;

    if (!ctx?.organizationId) {
      return res.status(403).json({
        error: "Forbidden",
        message: "No organization context",
      });
    }
    if (requestedOrg && requestedOrg !== ctx.organizationId) {
      return res.status(403).json({
        error: "Access denied. You are not a member of this organization.",
      });
    }

    const user = await getUserWithMemberships(userId);

    if (!user) return res.status(404).json({ error: "User not found" });

    let access = await getLeadAccessWhereForUser(user, resolvedOrg);
    if (access.isForbidden && !requestedOrg) {
      // If the resolved org context is not accessible, fall back to "all orgs I belong to".
      access = await getLeadAccessWhereForUser(user, null);
    }
    if (access.isForbidden) {
      return res.status(403).json({
        error: "Access denied. You are not a member of this organization.",
      });
    }
    if (access.isEmpty) {
      return res.json({ data: [], total: 0, page: pageNumber, totalPages: 0 });
    }
    // AND, not a spread: see getLeads.
    const filters = {};

    // Search filter
    if (search) {
      filters.OR = [
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ];
    }

    // Status filter
    if (status && status !== "all") {
      filters.status = { equals: status, mode: "insensitive" };
    }

    // Campaign filter (comma-separated ids)
    if (campaignIds) {
      const ids = String(campaignIds)
        .split(",")
        .map((id) => String(id).trim())
        .filter(Boolean);
      if (ids.length) {
        filters.campaignId = { in: ids };
      }
    }

    // Date filter (createdAt)
    if (from && to) {
      const fromDate = new Date(String(from));
      const toDate = new Date(String(to));
      if (!Number.isNaN(fromDate.getTime()) && !Number.isNaN(toDate.getTime())) {
        filters.createdAt = { gte: fromDate, lte: toDate };
      }
    }

    const where = { AND: [access.where, filters] };

    const total = await prismaClient.lead.count({ where });

    const leads = await prismaClient.lead.findMany({
      where,
      select: leadListSelect,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });

    const totalPages = Math.ceil(total / take);
    res.json({ data: leads, total, page: pageNumber, limit: take, totalPages });
  } catch (error) {
    logger.error({ err: error }, "Error fetching paginated leads");
    res
      .status(500)
      .json({ error: "Unable to get leads", details: error.message });
  }
};

const downloadLeadsCsv = async (req, res) => {
  try {
    const ctx = req.authContext;
    const { userId } = req.auth || {};
    if (!userId || !ctx?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const {
      search = "",
      status = "all",
      campaignIds,
      from,
      to,
      organizationId,
      limit,
    } = req.query;

    const requestedOrg =
      organizationId != null && String(organizationId).trim() !== ""
        ? String(organizationId)
        : null;
    const resolvedOrg = requestedOrg ?? ctx?.organizationId;

    if (!ctx?.organizationId) {
      return res.status(403).json({
        error: "Forbidden",
        message: "No organization context",
      });
    }
    if (requestedOrg && requestedOrg !== ctx.organizationId) {
      return res.status(403).json({
        error: "Access denied. You are not a member of this organization.",
      });
    }

    const user = await getUserWithMemberships(userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    let access = await getLeadAccessWhereForUser(user, resolvedOrg);
    if (access.isForbidden && !requestedOrg) {
      access = await getLeadAccessWhereForUser(user, null);
    }
    if (access.isForbidden) {
      return res.status(403).json({
        error: "Access denied. You are not a member of this organization.",
      });
    }
    if (access.isEmpty) {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="leads.csv"',
      );
      return res.send(
        "ID,First Name,Last Name,Email,Phone,Status,Campaign,Created At\n",
      );
    }

    // AND, not a spread: see getLeads.
    const filters = {};

    if (search) {
      filters.OR = [
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ];
    }

    if (status && status !== "all") {
      filters.status = { equals: status, mode: "insensitive" };
    }

    if (campaignIds) {
      const ids = String(campaignIds)
        .split(",")
        .map((id) => String(id).trim())
        .filter(Boolean);
      if (ids.length) {
        filters.campaignId = { in: ids };
      }
    }

    if (from && to) {
      const fromDate = new Date(String(from));
      const toDate = new Date(String(to));
      if (!Number.isNaN(fromDate.getTime()) && !Number.isNaN(toDate.getTime())) {
        filters.createdAt = { gte: fromDate, lte: toDate };
      }
    }

    const where = { AND: [access.where, filters] };

    const exportLimit = Math.min(
      Math.max(Number(limit) || MAX_EXPORT_LIMIT, 1),
      MAX_EXPORT_LIMIT,
    );

    const leads = await prismaClient.lead.findMany({
      where,
      select: leadListSelect,
      orderBy: { createdAt: "desc" },
      take: exportLimit,
    });

    const fields = [
      { label: "ID", value: "id" },
      { label: "First Name", value: "firstName" },
      { label: "Last Name", value: "lastName" },
      { label: "Email", value: "email" },
      { label: "Phone", value: "phone" },
      { label: "Status", value: "status" },
      { label: "Campaign", value: (row) => row.campaign?.name || "N/A" },
      {
        label: "Created At",
        value: (row) =>
          row.createdAt ? new Date(row.createdAt).toISOString() : "",
      },
    ];

    const parser = new Parser({ fields });
    const csv = parser.parse(leads);

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="leads.csv"');
    return res.send(csv);
  } catch (error) {
    logger.error({ err: error }, "Error downloading leads csv");
    return res.status(500).json({
      error: "Unable to download leads",
      details: error.message,
    });
  }
};

const getMonthlyLeadsByUser = async (req, res) => {
  try {
    const { userId } = req.auth;
    const ctx = req.authContext;

    if (!userId) {
      return res.status(400).json({ error: "User ID not found" });
    }

    let where = {};
    const now = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(now.getDate() - 30);

    const scope = await resolveLeadScope(req);
    if (!scope.ok) {
      return res.status(scope.status).json({ error: scope.error });
    }
    if (scope.empty) return res.json([]);

    where = {
      ...scope.where,
      createdAt: { gte: thirtyDaysAgo, lte: now },
    };

    const leads = await prismaClient.lead.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        status: true,
        userId: true,
        date: true,
        routeId: true,
        campaignId: true,
        webhookResponse: true,
        createdAt: true,
        updatedAt: true,
        sub1: true,
        sub2: true,
        sub3: true,
        sub4: true,
        ip: true,
        campaign: {
          select: {
            id: true,
            name: true,
          },
        },
        route: {
          select: {
            payout: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    res.status(200).json(leads);
  } catch (error) {
    logger.error({ err: error }, "Error fetching leads from past 30 days");
    res.status(500).json({
      error: "Unable to get leads from past 30 days",
      details: error.message,
    });
  }
};

const getPastTenDaysLeadsByUser = async (req, res) => {
  try {
    const { userId } = req.auth;
    const ctx = req.authContext;
    if (!userId) {
      return res.status(400).json({ error: "User ID not found" });
    }

    let where = {};
    const now = new Date();
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(now.getDate() - 10);
    const nowTime = new Date();

    const scope = await resolveLeadScope(req);
    if (!scope.ok) {
      return res.status(scope.status).json({ error: scope.error });
    }
    if (scope.empty) return res.json([]);

    where = {
      ...scope.where,
      createdAt: { gte: tenDaysAgo, lte: nowTime },
    };

    const exportLimit = Math.min(
      Math.max(Number(req.query.limit) || 500, 1),
      MAX_EXPORT_LIMIT,
    );
    const leads = await prismaClient.lead.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        status: true,
        userId: true,
        date: true,
        routeId: true,
        campaignId: true,
        webhookResponse: true,
        createdAt: true,
        updatedAt: true,
        campaign: {
          select: {
            id: true,
            name: true,
          },
        },
        route: {
          select: {
            payout: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: exportLimit,
    });
    res.status(200).json(leads);
  } catch (error) {
    logger.error({ err: error }, "Error fetching monthly leads");
    res.status(500).json({
      error: "Unable to get monthly leads",
      details: error.message,
    });
  }
};

/**
 * Change a lead's status from the dashboard.
 *
 * Status is the only field the dashboard edits, so it is the only one accepted.
 * This replaced PUT /api/v1/leads/update, which sat on the public router with no
 * authentication and passed the request body straight to Prisma.
 */
const updateLeadStatus = async (req, res) => {
  const { id } = req.params;
  const status = normalizeLeadStatus(req.body?.status);
  if (!status) {
    return res.status(400).json({ error: "Invalid status", valid_statuses: LEAD_STATUSES });
  }

  try {
    const scope = await resolveLeadScope(req);
    if (!scope.ok) {
      return res.status(scope.status).json({ error: scope.error });
    }

    const lead = await findInScope(prismaClient.lead, scope, id, { id: true });
    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const updated = await prismaClient.lead.update({
      where: { id: lead.id },
      data: { status },
      select: { id: true, status: true, updatedAt: true },
    });

    req.log.info({ evt: "lead_update", leadId: id, status }, "lead status updated");
    return res.status(200).json({ success: true, data: updated });
  } catch (err) {
    req.log.error({ evt: "lead_update", leadId: id, err }, "lead status update failed");
    return res.status(500).json({ error: "Failed to update lead" });
  }
};

export { getLeads, addLead, updateLeadStatus, getLeadsByUser, getLeadsByUserPagination, downloadLeadsCsv, getMonthlyLeadsByUser, getPastTenDaysLeadsByUser };
