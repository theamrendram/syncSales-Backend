const prismaClient = require("../utils/prismaClient");
const logger = require("../utils/logger");
const { resolveLeadScope } = require("../utils/lead-scope");
const {
  AGING_BUCKETS,
  SUB_FIELDS,
  getPendingAging,
  getDeliveryHealth,
  getSubBreakdown,
  getRouteSeries,
} = require("../utils/lead-insights");
const {
  chartMetrics,
  generateExtendedReport,
  getLeadsGroupedByDateRouteCampaign,
} = require("../utils/chart-functions");

const DAY_MS = 24 * 60 * 60 * 1000;

const CHART_PARTS = ["metrics", "series", "report"];

/** Every date this app reports is an IST calendar date. Stated, not implied. */
const TIMEZONE = "Asia/Kolkata";

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

  /**
   * How far back the window *ends*, in days. Zero — the default, and what every
   * caller written before this sent — ends at now and preserves the original
   * open-ended `gte` filter exactly.
   *
   * A non-zero offset slides the same `days`-wide window into the past so the
   * report can ask for the period preceding the one on screen. Fetching one
   * double-width window and splitting it client-side would have been simpler,
   * but `take: limit` keeps the *newest* rows, so a truncated double window
   * silently drops the older half — inflating every period-over-period delta.
   * Two independently-bounded requests each report their own truncation.
   */
  const offsetDays = Math.min(Math.max(Number(req.query.offsetDays) || 0, 0), 365);

  const now = Date.now();
  const endDate = offsetDays > 0 ? new Date(now - offsetDays * DAY_MS) : null;
  const startDate = new Date(
    (endDate ? endDate.getTime() : now) - days * DAY_MS,
  );

  const scope = await resolveLeadScope(req);
  if (!scope.ok) return scope;

  if (scope.empty) {
    return { ok: true, leads: [], days, limit, offsetDays };
  }

  // `lt` only appears for a past window; the live window stays open-ended so a
  // lead written between the timestamp and the query still lands in it.
  const createdAt = endDate
    ? { gte: startDate, lt: endDate }
    : { gte: startDate };

  const leads = await prismaClient.lead.findMany({
    where: { ...scope.where, createdAt },
    include: {
      campaign: { select: { name: true, campId: true } },
      route: { select: { payout: true, name: true, routeId: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return { ok: true, leads, days, limit, offsetDays };
};

/**
 * Response metadata for a loaded window.
 *
 * `truncated` is the one signal a caller has that it is looking at a partial
 * window: `take: limit` keeps the newest rows, so hitting the cap means older
 * leads were dropped and every aggregate over them understates the past.
 */
const buildMeta = ({ days, limit, offsetDays, leads }) => ({
  days,
  limit,
  offsetDays,
  returned: leads.length,
  truncated: leads.length >= limit,
});

const getChartData = async (req, res) => {
  try {
    const scope = await loadScopedLeads(req);
    if (!scope.ok) {
      return res.status(scope.status).json({ error: scope.error });
    }

    const { leads } = scope;
    const parts = parseInclude(req.query.include);

    const responseData = {
      totalLeads: leads.length,
      meta: buildMeta(scope),
    };

    if (parts.has("metrics")) {
      responseData.metricData = chartMetrics(leads, { days: scope.days });
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

    const { leads } = scope;

    return res.status(200).json({
      metricData: chartMetrics(leads, { days: scope.days }),
      meta: buildMeta(scope),
    });
  } catch (error) {
    logger.error({ err: error }, "Error getting metric data");
    res.status(500).json({
      error: "Unable to get chart data",
      details: error.message,
    });
  }
};

/**
 * Operational health: what is stuck, and what never arrived.
 *
 * Kept off `/chart` because the two halves answer questions the report window
 * cannot. Pending aging looks at every outstanding lead regardless of date —
 * the interesting ones are precisely those too old to appear in a window — while
 * delivery failures are windowed like the rest of the report.
 */
const getLeadHealth = async (req, res) => {
  try {
    const scope = await resolveLeadScope(req);
    if (!scope.ok) {
      return res.status(scope.status).json({ error: scope.error });
    }

    if (scope.empty) {
      return res.status(200).json({
        pendingAging: [],
        deliveryHealth: [],
        buckets: AGING_BUCKETS,
        meta: { days: 0 },
      });
    }

    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 90);
    const startDate = new Date(Date.now() - days * DAY_MS);

    const [pendingAging, deliveryHealth] = await Promise.all([
      getPendingAging(scope),
      getDeliveryHealth({ where: scope.where, startDate }),
    ]);

    return res.status(200).json({
      pendingAging,
      deliveryHealth,
      buckets: AGING_BUCKETS,
      meta: { days },
    });
  } catch (error) {
    logger.error({ err: error }, "Error getting lead health");
    res.status(500).json({
      error: "Unable to get lead health",
      details: error.message,
    });
  }
};

/**
 * Quality of the highest-volume values on one sub-ID field.
 *
 * `field` is validated against a fixed list rather than interpolated: it names
 * a database column, and the only safe way to accept a column name from a query
 * string is to refuse anything not on the list.
 */
const getSubIdBreakdown = async (req, res) => {
  try {
    const field = String(req.query.field || "sub1");

    if (!SUB_FIELDS.includes(field)) {
      return res.status(400).json({
        error: "Invalid sub field",
        valid_fields: SUB_FIELDS,
      });
    }

    const scope = await resolveLeadScope(req);
    if (!scope.ok) {
      return res.status(scope.status).json({ error: scope.error });
    }

    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 90);

    if (scope.empty) {
      return res
        .status(200)
        .json({ field, values: [], truncated: false, meta: { days } });
    }

    const startDate = new Date(Date.now() - days * DAY_MS);
    const routeId = req.query.routeId ? String(req.query.routeId) : undefined;

    const breakdown = await getSubBreakdown({
      where: scope.where,
      startDate,
      field,
      routeId,
    });

    return res.status(200).json({ ...breakdown, meta: { days } });
  } catch (error) {
    logger.error({ err: error }, "Error getting sub ID breakdown");
    res.status(500).json({
      error: "Unable to get sub ID breakdown",
      details: error.message,
    });
  }
};

/**
 * One route's daily performance, for the per-route performance page.
 *
 * `:routeId` is `Route.id` — the uuid — not the `routeId` autoincrement the UI
 * displays. The uuid is what every lead's foreign key points at, and it is not
 * enumerable, which the sequential one is.
 *
 * The window is `days` wide and ends now, like `/chart`. No `offsetDays` here:
 * a period-over-period comparison would be a second call with a shifted window,
 * and nothing asks for one yet.
 */
const getRoutePerformance = async (req, res) => {
  try {
    const routeId = String(req.params.routeId || "").trim();

    if (!routeId) {
      return res.status(400).json({ error: "Route ID is required" });
    }

    const scope = await resolveLeadScope(req);
    if (!scope.ok) {
      return res.status(scope.status).json({ error: scope.error });
    }

    /**
     * A webmaster is checked against their assignments *before* the route is
     * loaded, and refused with the same 404 an unknown id gets.
     *
     * Spreading `scope.where` into the lead query already stops them reading
     * another route's leads, but it would not stop them reading its metadata —
     * and `payout` is the number their own payout is a cut of. Answering 403
     * rather than 404 would leak which uuids are real, so both cases return the
     * same thing.
     */
    if (
      req.authContext?.isWebmaster &&
      !(scope.routeIds ?? []).includes(routeId)
    ) {
      return res.status(404).json({ error: "Route not found" });
    }

    const route = await prismaClient.route.findFirst({
      // Scoped to the caller's organization, so a valid uuid from another org
      // is indistinguishable from one that does not exist.
      where: { id: routeId, organizationId: scope.organizationId },
      select: {
        id: true,
        routeId: true,
        name: true,
        product: true,
        payout: true,
        hasWebhook: true,
        // Soft-deleted routes still resolve: their history is the reason
        // someone opens this page. The flag lets the UI say so.
        deletedAt: true,
      },
    });

    if (!route) {
      return res.status(404).json({ error: "Route not found" });
    }

    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 90);
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * DAY_MS);

    // A webmaster assigned nothing never reaches here — the check above 404s
    // first — but `resolveLeadScope` can still report an empty scope, and it
    // carries no `where` to spread.
    if (scope.empty) {
      return res.status(200).json({
        route,
        series: [],
        totals: null,
        meta: { days, returned: 0, truncated: false, timezone: TIMEZONE },
      });
    }

    const { series, totals, returned, truncated } = await getRouteSeries({
      where: scope.where,
      routeId: route.id,
      payout: route.payout,
      startDate,
      endDate,
    });

    return res.status(200).json({
      route,
      series,
      totals,
      meta: {
        days,
        // The IST calendar days the series spans, so the caller never has to
        // re-derive the window it asked for.
        start: series[0]?.date ?? null,
        end: series[series.length - 1]?.date ?? null,
        returned,
        truncated,
        timezone: TIMEZONE,
      },
    });
  } catch (error) {
    logger.error({ err: error }, "Error getting route performance");
    res.status(500).json({
      error: "Unable to get route performance",
      details: error.message,
    });
  }
};

module.exports = {
  getChartData,
  getMetricData,
  getLeadHealth,
  getSubIdBreakdown,
  getRoutePerformance,
};
