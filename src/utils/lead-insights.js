const { Prisma } = require("@prisma/client");
const prismaClient = require("./prismaClient");
const logger = require("./logger");
const { getISTDateString } = require("./chart-functions");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Every derivation here aggregates in the database rather than walking a page
 * of leads in memory like `chart-functions` does.
 *
 * That is not a style preference. Pending aging asks about leads a client has
 * left unanswered for weeks, and sub-ID quality asks about the long tail of a
 * traffic source — both questions are about rows that fall outside the capped,
 * recent window the report table is built from, so an in-memory scan would
 * answer them wrongly rather than slowly.
 */

/**
 * Age bands for leads a client has not ruled on.
 *
 * `minDays` is the lower edge of the band and maps to the *upper* bound of
 * `createdAt` — an older lead has an earlier timestamp. The last band is
 * open-ended.
 */
const AGING_BUCKETS = [
  { key: "fresh", label: "Under 3 days", minDays: 0, maxDays: 3 },
  { key: "aging", label: "3 to 7 days", minDays: 3, maxDays: 7 },
  { key: "stale", label: "Over 7 days", minDays: 7, maxDays: null },
];

const SUB_FIELDS = ["sub1", "sub2", "sub3", "sub4"];

/** How many sub-ID values to profile. The tail is unbounded; the head is not. */
const SUB_VALUE_LIMIT = 25;

/**
 * The postback handler title-cases whatever string the client sent, so a client
 * posting `PENDING` stores `PENDING`. Comparisons on status must be
 * case-insensitive or they silently miss those rows.
 */
const statusFilter = (status) => ({ equals: status, mode: "insensitive" });

const bucketRange = (bucket, now) => ({
  // Older than the band's upper edge...
  ...(bucket.maxDays !== null
    ? { gt: new Date(now - bucket.maxDays * DAY_MS) }
    : {}),
  // ...and at least as old as its lower edge.
  lte: new Date(now - bucket.minDays * DAY_MS),
});

const countByRoute = (rows) => {
  const byRoute = new Map();
  for (const row of rows) {
    byRoute.set(row.routeId, row._count?._all ?? 0);
  }
  return byRoute;
};

/**
 * Still-pending leads per route, banded by how long they have been waiting.
 *
 * Deliberately not restricted to the report's date window: a lead the client
 * has ignored for six weeks is precisely what this is meant to surface, and it
 * sits outside any window someone would sensibly have on screen.
 */
const getPendingAging = async ({ where }) => {
  const now = Date.now();

  const results = await Promise.all(
    AGING_BUCKETS.map((bucket) =>
      prismaClient.lead.groupBy({
        by: ["routeId"],
        where: {
          ...where,
          status: statusFilter("Pending"),
          createdAt: bucketRange(bucket, now),
        },
        _count: { _all: true },
      }),
    ),
  );

  const counts = results.map(countByRoute);
  const routeIds = new Set(counts.flatMap((map) => Array.from(map.keys())));

  if (!routeIds.size) return [];

  const routes = await prismaClient.route.findMany({
    where: { id: { in: Array.from(routeIds) } },
    select: { id: true, name: true, routeId: true, payout: true },
  });

  return routes
    .map((route) => {
      const buckets = AGING_BUCKETS.map((bucket, index) => ({
        key: bucket.key,
        label: bucket.label,
        count: counts[index].get(route.id) ?? 0,
      }));

      const pending = buckets.reduce((sum, bucket) => sum + bucket.count, 0);

      return {
        route: route.name,
        routeId: route.routeId,
        payout: route.payout,
        pending,
        // What the client still owes if they approve everything outstanding.
        pendingValue: pending * route.payout,
        buckets,
      };
    })
    .filter((entry) => entry.pending > 0)
    .sort((a, b) => b.pendingValue - a.pendingValue);
};

/**
 * Per-route webhook delivery failures inside the window.
 *
 * A failed send stores `{ error, timestamp }` in `webhookResponse`; a delivered
 * one stores whatever the buyer replied. So the presence of an `error` key is
 * the failure signal, and a null column means the route has no webhook or the
 * send has not finished.
 *
 * Returns `null` rather than throwing if the JSON path filter is unsupported by
 * the running database — this is a diagnostic panel, and losing it should not
 * take the endpoint down with it.
 */
const getDeliveryHealth = async ({ where, startDate }) => {
  const createdAt = { gte: startDate };

  try {
    const [failures, attempts] = await Promise.all([
      prismaClient.lead.groupBy({
        by: ["routeId"],
        where: {
          ...where,
          createdAt,
          webhookResponse: { path: ["error"], not: Prisma.DbNull },
        },
        _count: { _all: true },
      }),
      // Only routes that actually send count as attempts; a route with no
      // webhook configured is not failing, it is not trying.
      prismaClient.lead.groupBy({
        by: ["routeId"],
        where: { ...where, createdAt, route: { hasWebhook: true } },
        _count: { _all: true },
      }),
    ]);

    const failed = countByRoute(failures);
    const attempted = countByRoute(attempts);

    if (!attempted.size) return [];

    const routes = await prismaClient.route.findMany({
      where: { id: { in: Array.from(attempted.keys()) } },
      select: { id: true, name: true, routeId: true },
    });

    return routes
      .map((route) => {
        const total = attempted.get(route.id) ?? 0;
        const failedCount = failed.get(route.id) ?? 0;

        return {
          route: route.name,
          routeId: route.routeId,
          attempted: total,
          failed: failedCount,
          failureRate: total > 0 ? (failedCount / total) * 100 : 0,
        };
      })
      .sort((a, b) => b.failureRate - a.failureRate);
  } catch (error) {
    logger.warn(
      { err: error },
      "Delivery health unavailable — webhookResponse filter rejected",
    );
    return null;
  }
};

/**
 * Quality of the top sub-ID values on one sub field.
 *
 * Sub IDs are the traffic source's own labels — a placement, a creative, a
 * publisher — and they are the finest grain at which a user can act. Their
 * cardinality is unbounded, so this profiles only the highest-volume values
 * and says so rather than streaming the tail.
 *
 * Status counts come back grouped by route as well as by value: payout lives on
 * the route, so a sub value spanning two clients has no single payout and its
 * revenue can only be summed per route.
 */
const getSubBreakdown = async ({ where, startDate, field, routeId }) => {
  if (!SUB_FIELDS.includes(field)) {
    throw new Error(`Unsupported sub field: ${field}`);
  }

  const baseWhere = {
    ...where,
    createdAt: { gte: startDate },
    // A null sub is "the source sent no label", not a value worth profiling.
    [field]: { not: null },
    ...(routeId ? { routeId } : {}),
  };

  const topValues = await prismaClient.lead.groupBy({
    by: [field],
    where: baseWhere,
    _count: { _all: true },
    orderBy: { _count: { [field]: "desc" } },
    take: SUB_VALUE_LIMIT,
  });

  if (!topValues.length) {
    return { field, values: [], truncated: false };
  }

  const values = topValues.map((row) => row[field]);

  const detail = await prismaClient.lead.groupBy({
    by: [field, "routeId", "status"],
    where: { ...baseWhere, [field]: { in: values } },
    _count: { _all: true },
  });

  const routes = await prismaClient.route.findMany({
    where: { id: { in: Array.from(new Set(detail.map((row) => row.routeId))) } },
    select: { id: true, name: true, payout: true },
  });
  const payouts = new Map(routes.map((route) => [route.id, route.payout]));
  const routeNames = new Map(routes.map((route) => [route.id, route.name]));

  const assembled = new Map();

  for (const row of detail) {
    const value = row[field];
    let entry = assembled.get(value);

    if (!entry) {
      entry = {
        value,
        submitted: 0,
        approved: 0,
        trash: 0,
        duplicates: 0,
        pending: 0,
        other: 0,
        earnedRevenue: 0,
        routes: new Set(),
      };
      assembled.set(value, entry);
    }

    const count = row._count?._all ?? 0;
    const payout = payouts.get(row.routeId) ?? 0;

    entry.submitted += count;
    entry.routes.add(routeNames.get(row.routeId) ?? row.routeId);

    switch (String(row.status ?? "").toLowerCase()) {
      case "approved":
        entry.approved += count;
        entry.earnedRevenue += count * payout;
        break;
      case "trash":
        entry.trash += count;
        break;
      case "duplicate":
        entry.duplicates += count;
        break;
      case "pending":
        entry.pending += count;
        break;
      default:
        entry.other += count;
    }
  }

  const result = Array.from(assembled.values())
    .map(({ routes: routeSet, ...entry }) => {
      const decided = entry.submitted - entry.pending;
      return {
        ...entry,
        decided,
        approvalRate: decided > 0 ? (entry.approved / decided) * 100 : 0,
        routes: Array.from(routeSet).sort(),
      };
    })
    .sort((a, b) => b.submitted - a.submitted);

  return {
    field,
    values: result,
    // The caller is looking at a head, not a census.
    truncated: topValues.length === SUB_VALUE_LIMIT,
  };
};

/**
 * Safety cap on the daily series. One route over at most 90 days has to be
 * extraordinarily busy to reach this — but `take` keeps the newest rows, so a
 * caller that does hit it loses the *oldest* days, which on a line chart reads
 * as traffic that started late rather than data that was dropped. Hence the
 * `truncated` flag travelling with the series.
 */
const MAX_SERIES_LEADS = 50000;

const round2 = (value) => Math.round(value * 100) / 100;

const emptyDay = (date) => ({
  date,
  submitted: 0,
  approved: 0,
  trash: 0,
  duplicates: 0,
  pending: 0,
  other: 0,
});

/**
 * Every IST calendar day in the window, inclusive of both ends.
 *
 * The series is zero-filled from this rather than emitting only days that
 * happen to have leads. A line chart given a sparse series draws a straight
 * segment across the gap, which reads as steady traffic over a period that
 * actually had none — the opposite of the truth. Filling here rather than in
 * the UI means every consumer gets it right, and only this module has to know
 * which calendar the app counts in.
 *
 * Stepping happens on UTC midnights of the already-converted date strings, so
 * it is plain integer date arithmetic with no second timezone conversion to
 * get wrong.
 */
const buildDateRange = (startDate, endDate) => {
  const cursor = new Date(`${getISTDateString(startDate)}T00:00:00Z`);
  const last = new Date(`${getISTDateString(endDate)}T00:00:00Z`);
  const dates = [];

  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
};

/**
 * One route's daily performance over the window.
 *
 * Unlike the dashboard's `/chart`, this is not built from the shared capped
 * page of leads. That page holds the newest `limit` rows *across every route*,
 * so a quiet route sharing an org with a busy one loses its older days to the
 * cap — and on a per-route line chart that is indistinguishable from the route
 * having gone dead. Scoping the query to one route and selecting two columns
 * makes an exact count affordable instead.
 *
 * `where` is the caller's lead scope from `resolveLeadScope`, spread rather
 * than replaced: it is what confines a webmaster to their own campaigns, and a
 * bare `routeId` filter in its place would hand them every lead on the route.
 *
 * Payout lives on the route and is constant across its leads, so both revenue
 * figures are a multiplication rather than a per-lead sum.
 */
const getRouteSeries = async ({
  where,
  routeId,
  payout = 0,
  startDate,
  endDate,
}) => {
  const leads = await prismaClient.lead.findMany({
    where: { ...where, routeId, createdAt: { gte: startDate, lte: endDate } },
    // Two scalars, no relations: the whole point of not reusing the dashboard's
    // query, which pulls every column plus two joins for each lead.
    select: { createdAt: true, status: true },
    orderBy: { createdAt: "desc" },
    take: MAX_SERIES_LEADS,
  });

  const byDate = new Map(
    buildDateRange(startDate, endDate).map((date) => [date, emptyDay(date)]),
  );

  for (const lead of leads) {
    if (!lead.createdAt) continue;

    const day = byDate.get(getISTDateString(lead.createdAt));
    // A lead can fall outside the range only if the window edges moved between
    // building the range and the query returning; dropping it beats creating a
    // stray point at the end of the chart.
    if (!day) continue;

    day.submitted += 1;

    // Case-insensitive for the same reason every other status comparison here
    // is: the postback handler stores the client's raw casing.
    switch (String(lead.status ?? "").toLowerCase()) {
      case "approved":
        day.approved += 1;
        break;
      case "trash":
        day.trash += 1;
        break;
      case "duplicate":
        day.duplicates += 1;
        break;
      case "pending":
        day.pending += 1;
        break;
      default:
        day.other += 1;
    }
  }

  const totals = emptyDay(null);

  const series = Array.from(byDate.values()).map((day) => {
    for (const key of ["submitted", "approved", "trash", "duplicates", "pending", "other"]) {
      totals[key] += day[key];
    }

    // Pending is excluded from the denominator, matching `chartMetrics` and
    // `/reports/statistics`: a backlog of undecided leads is not a rejection.
    const decided = day.submitted - day.pending;

    return {
      ...day,
      decided,
      approvalRate: decided > 0 ? round2((day.approved / decided) * 100) : 0,
      submittedRevenue: round2(day.submitted * payout),
      earnedRevenue: round2(day.approved * payout),
    };
  });

  const decidedTotal = totals.submitted - totals.pending;
  const { date: _ignored, ...totalCounts } = totals;

  return {
    series,
    totals: {
      ...totalCounts,
      decided: decidedTotal,
      approvalRate:
        decidedTotal > 0 ? round2((totals.approved / decidedTotal) * 100) : 0,
      submittedRevenue: round2(totals.submitted * payout),
      earnedRevenue: round2(totals.approved * payout),
      // What the client still owes if every outstanding lead is approved.
      pipelineRevenue: round2(totals.pending * payout),
    },
    returned: leads.length,
    truncated: leads.length >= MAX_SERIES_LEADS,
  };
};

module.exports = {
  AGING_BUCKETS,
  SUB_FIELDS,
  SUB_VALUE_LIMIT,
  MAX_SERIES_LEADS,
  getPendingAging,
  getDeliveryHealth,
  getSubBreakdown,
  getRouteSeries,
};
