/**
 * Which rows a caller may see, as a Prisma `where` fragment.
 *
 * This is the resource-access stage: the one after permissions. `campaign:read`
 * says the caller may read campaigns at all; this says *which* campaigns. No
 * permission string can express "only the ones assigned to you", which is why it
 * cannot live in the role.
 *
 * A member with no explicit grants sees their whole organization. A member with
 * any grant sees only what was granted. That is the whole of what "webmaster"
 * used to mean, without a separate account type to carry it.
 *
 * Advertisers and publishers (NARROWED_ROLES) are always narrowed: with no
 * grants they see nothing rather than everything, so inviting one cannot expose
 * the organization before anyone has assigned them a campaign. A publisher is
 * narrowed further, to the leads they sent (`Lead.userId`, the key owner).
 *
 * It returns a fragment rather than a boolean on purpose. A boolean has to be
 * turned into a query by whoever asked, and every one of those is a place to get
 * it wrong — before this existed, four controllers each rebuilt the same
 * webmaster narrowing by hand, and forgetting it returned the whole
 * organization rather than nothing. A fragment can only be spread.
 *
 * Contract:
 *   { ok: false, status, error }                 — forward verbatim
 *   { ok: true, empty: true, organizationId }    — scoped to nothing; run no
 *                                                  query, and every aggregate
 *                                                  is empty
 *   { ok: true, empty: false, where, organizationId }
 *
 * `empty: true` is not the same as a `where` that matches nothing. It says the
 * caller is legitimately entitled to zero rows, so a list is `[]` and a count is
 * 0 without a round trip — and, importantly, without an unscoped query being a
 * plausible way to get there.
 *
 * Soft deletion is deliberately absent. `deletedAt` is a business filter, not an
 * authorization one, and mixing the two would mean a caller could not be shown a
 * deleted row they are entitled to see.
 */
import { isNarrowedRole } from "../lib/org-roles.js";
import {
  getGrantedCampaignIds,
  getGrantedRouteIds,
  getGrantedLeadScope,
  hasResourceGrants,
} from "./resource-grants.js";

export const SCOPED_RESOURCES = ["lead", "campaign", "route"];

const deny = (status, error) => ({ ok: false, status, error });

/**
 * Lead rows are reachable two ways — by campaign or by an explicitly granted
 * route — so a webmaster's scope is a union rather than a single id list.
 */
async function leadScope(userId, organizationId, role) {
  const { campaignIds, routeIds } = await getGrantedLeadScope(
    userId,
    organizationId,
  );

  if (!campaignIds.length && !routeIds.length) {
    return { ok: true, empty: true, organizationId };
  }

  return {
    ok: true,
    empty: false,
    organizationId,
    where: {
      organizationId,
      // Publishers see only what they sent, even on a campaign other
      // publishers also post to.
      ...(role === "publisher" ? { userId } : {}),
      OR: [
        ...(campaignIds.length ? [{ campaignId: { in: campaignIds } }] : []),
        ...(routeIds.length ? [{ routeId: { in: routeIds } }] : []),
      ],
    },
  };
}

async function idScope(organizationId, ids) {
  if (!ids.length) {
    return { ok: true, empty: true, organizationId };
  }
  return {
    ok: true,
    empty: false,
    organizationId,
    where: { organizationId, id: { in: ids } },
  };
}

/**
 * @param {object} req  after requireAuth() and authenticationContext()
 * @param {"lead"|"campaign"|"route"} resource
 */
export async function resolveScope(req, resource) {
  const { userId } = req.auth ?? {};
  const ctx = req.authContext;

  if (!userId) return deny(400, "User ID not found");

  const organizationId = ctx?.organizationId;
  if (!organizationId) return deny(403, "Unauthorized");

  // An owner without a membership row has no role here, which is the
  // un-narrowed case — correct, since they own the organization.
  return scopeFor({
    userId,
    organizationId,
    role: ctx.membership?.role ?? null,
    resource,
  });
}

/**
 * The same answer as resolveScope, for callers that have the pieces but no
 * request — the lead list helpers in leads.controller.js.
 */
export async function scopeFor({ userId, organizationId, role, resource }) {
  if (!SCOPED_RESOURCES.includes(resource)) {
    // A typo in a route definition must not silently widen access, so an unknown
    // resource refuses rather than falling through to the organization scope.
    throw new Error(`No scope defined for resource "${resource}"`);
  }
  if (!userId || !organizationId) return deny(403, "Unauthorized");

  // Narrowed by role, or by having been granted anything at all. The second
  // keeps the pre-role behaviour for a manager someone chose to restrict.
  const narrowed =
    isNarrowedRole(role) || (await hasResourceGrants(userId, organizationId));
  if (!narrowed) {
    return {
      ok: true,
      empty: false,
      organizationId,
      where: { organizationId },
    };
  }

  switch (resource) {
    case "lead":
      return leadScope(userId, organizationId, role);
    case "campaign":
      return idScope(
        organizationId,
        await getGrantedCampaignIds(userId, organizationId),
      );
    case "route":
      return idScope(
        organizationId,
        await getGrantedRouteIds(userId, organizationId),
      );
    default:
      return deny(403, "Unauthorized");
  }
}

/**
 * Whether this caller may act on one specific row.
 *
 * Asks the same question a list does, narrowed to one id, so a single-row
 * endpoint cannot disagree with the list it came from.
 *
 * Answers 404 rather than 403 for a row outside the scope: "this exists but is
 * not yours" tells an unauthorized caller that the id is real, which is itself
 * worth not saying.
 */
export async function findInScope(delegate, scope, id, select) {
  if (scope.empty) return null;
  return delegate.findFirst({
    // AND, not a spread. A scope can itself constrain `id` — a webmaster's is
    // `id: { in: [...] }` — and `{ id, ...scope.where }` lets that clause
    // overwrite the id being asked for, so the query returns *some* row in scope
    // rather than the requested one. Spreading the other way loses the scope's
    // own id constraint instead, which is worse: it would find rows outside it.
    where: { AND: [{ id }, scope.where] },
    ...(select ? { select } : {}),
  });
}
