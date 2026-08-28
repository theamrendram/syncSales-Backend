const { Prisma } = require("@prisma/client");
const prismaClient = require("./prismaClient");
const logger = require("./logger");

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

module.exports = {
  AGING_BUCKETS,
  SUB_FIELDS,
  SUB_VALUE_LIMIT,
  getPendingAging,
  getDeliveryHealth,
  getSubBreakdown,
};
