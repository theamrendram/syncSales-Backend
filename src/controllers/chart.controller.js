const prismaClient = require("../utils/prismaClient");
const logger = require("../utils/logger");
const { getLeadScopeForWebmaster } = require("../utils/webmaster-campaigns");
const {
  chartMetrics,
  generateExtendedReport,
  getLeadsGroupedByDateRouteCampaign,
} = require("../utils/chart-functions");

const CHART_PARTS = ["metrics", "series", "report"];

/**
 * Which slices of the chart payload the caller asked for.
 *
 * Accepts `?include=metrics,series` and the repeated form
 * `?include=metrics&include=series`. Anything absent, empty or unrecognised
 * resolves to all three parts, so callers written before `include` existed —
 * and anything hitting the endpoint by hand — keep getting the full payload.
 */
const parseInclude = (raw) => {
  const tokens = (Array.isArray(raw) ? raw : [raw])
    .flatMap((value) => String(value ?? "").split(","))
    .map((token) => token.trim())
    .filter((token) => CHART_PARTS.includes(token));

  return new Set(tokens.length ? tokens : CHART_PARTS);
};

/**
 * Resolve the caller's lead scope and load the window that every chart
 * derivation is computed from. Both endpoints below share this: it is a single
 * `findMany` of up to `limit` leads, and splitting the response into parts must
 * not turn into one scan per part.
 *
 * Returns `{ ok: false, status, error }` for the two rejection cases so callers
 * can forward them verbatim.
 *
 * A webmaster with no assigned campaigns or routes resolves to `leads: []` and
 * falls through rather than returning early — `chartMetrics` guards every
 * division and the other two derivations return `[]`, so the empty case now
 * produces the same response *shape* as any other. It previously short-circuited
 * to a hand-written object that matched neither endpoint's success shape.
 */
const loadScopedLeads = async (req) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 2000, 100), 5000);
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 90);
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const { userId } = req.auth;
  const ctx = req.authContext;

  if (!userId) {
    return { ok: false, status: 400, error: "User ID not found" };
  }

  let where;

  if (ctx?.isWebmaster) {
    const { campaignIds, routeIds } = await getLeadScopeForWebmaster(
      userId,
      ctx.organizationId,
    );

    if (!campaignIds.length && !routeIds.length) {
      return { ok: true, leads: [], days, limit };
    }
    where = {
      organizationId: ctx.organizationId,
      OR: [
        ...(campaignIds.length ? [{ campaignId: { in: campaignIds } }] : []),
        ...(routeIds.length ? [{ routeId: { in: routeIds } }] : []),
      ],
      createdAt: { gte: startDate },
    };
  } else if (ctx?.organizationId) {
    where = {
      organizationId: ctx.organizationId,
      createdAt: { gte: startDate },
    };
  } else {
    return { ok: false, status: 403, error: "Unauthorized" };
  }

  const leads = await prismaClient.lead.findMany({
    where,
    include: {
      campaign: { select: { name: true, campId: true } },
      route: { select: { payout: true, name: true, routeId: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return { ok: true, leads, days, limit };
};

const getChartData = async (req, res) => {
  try {
    const scope = await loadScopedLeads(req);
    if (!scope.ok) {
      return res.status(scope.status).json({ error: scope.error });
    }

    const { leads, days, limit } = scope;
    const parts = parseInclude(req.query.include);

    const responseData = {
      totalLeads: leads.length,
      meta: { days, limit, returned: leads.length },
    };

    if (parts.has("metrics")) {
      responseData.metricData = chartMetrics(leads);
    }

    if (parts.has("series")) {
      responseData.newChartData =
        await getLeadsGroupedByDateRouteCampaign(leads);
    }

    if (parts.has("report")) {
      responseData.extendedReport = generateExtendedReport(leads);
    }

    return res.status(200).json(responseData);
  } catch (error) {
    logger.error({ err: error }, "Error getting chart data");
    res.status(500).json({
      error: "Unable to get chart data",
      details: error.message,
    });
  }
};

const getMetricData = async (req, res) => {
  try {
    const scope = await loadScopedLeads(req);
    if (!scope.ok) {
      return res.status(scope.status).json({ error: scope.error });
    }

    const { leads, days, limit } = scope;

    return res.status(200).json({
      metricData: chartMetrics(leads),
      meta: { days, limit, returned: leads.length },
    });
  } catch (error) {
    logger.error({ err: error }, "Error getting metric data");
    res.status(500).json({
      error: "Unable to get chart data",
      details: error.message,
    });
  }
};

module.exports = {
  getChartData,
  getMetricData,
};
