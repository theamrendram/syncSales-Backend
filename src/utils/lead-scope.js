const { getLeadScopeForWebmaster } = require("./webmaster-campaigns");

/**
 * The set of leads a caller is allowed to see, as a reusable Prisma `where`
 * fragment carrying no date filter of its own.
 *
 * Extracted so the chart, health and sub-ID endpoints cannot drift apart on who
 * sees what. A webmaster is scoped to their assigned campaigns and routes; a
 * regular member to their organization. Every endpoint spreads this and adds
 * its own `createdAt`.
 *
 * Returns one of:
 *   { ok: false, status, error }  — forward verbatim
 *   { ok: true, empty: true }     — a webmaster assigned nothing; no query
 *                                   should run, and every aggregate is empty
 *   { ok: true, empty: false, where, organizationId }
 *
 * The webmaster branch also returns the `campaignIds` and `routeIds` it just
 * resolved. An endpoint addressing one route by id has to check that route
 * against the caller's assignments *before* it reads the route's own row —
 * `where` confines which leads come back but not which metadata does — and
 * handing back the ids already in hand keeps that check from re-running the
 * same three queries, or worse, growing its own copy of the scope rules.
 */
const resolveLeadScope = async (req) => {
  const { userId } = req.auth ?? {};
  const ctx = req.authContext;

  if (!userId) {
    return { ok: false, status: 400, error: "User ID not found" };
  }

  if (ctx?.isWebmaster) {
    const { campaignIds, routeIds } = await getLeadScopeForWebmaster(
      userId,
      ctx.organizationId,
    );

    if (!campaignIds.length && !routeIds.length) {
      return {
        ok: true,
        empty: true,
        organizationId: ctx.organizationId,
        campaignIds,
        routeIds,
      };
    }

    return {
      ok: true,
      empty: false,
      organizationId: ctx.organizationId,
      campaignIds,
      routeIds,
      where: {
        organizationId: ctx.organizationId,
        OR: [
          ...(campaignIds.length ? [{ campaignId: { in: campaignIds } }] : []),
          ...(routeIds.length ? [{ routeId: { in: routeIds } }] : []),
        ],
      },
    };
  }

  if (ctx?.organizationId) {
    return {
      ok: true,
      empty: false,
      organizationId: ctx.organizationId,
      where: { organizationId: ctx.organizationId },
    };
  }

  return { ok: false, status: 403, error: "Unauthorized" };
};

module.exports = { resolveLeadScope };
