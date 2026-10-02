/**
 * Lead scope, kept as its own entry point for the chart, health and sub-ID
 * endpoints that already call it.
 *
 * The logic now lives in src/utils/scope.js alongside the campaign and route
 * scopes, so the three cannot drift apart. This is the same contract it always
 * had; what changed is that it is one implementation rather than one of several.
 */
import { resolveScope } from "./scope.js";

/**
 * Returns one of:
 *   { ok: false, status, error }  — forward verbatim
 *   { ok: true, empty: true }     — entitled to no leads; run no query, and
 *                                   every aggregate is empty
 *   { ok: true, empty: false, where, organizationId }
 */
const resolveLeadScope = async (req) => {
  // withScope("lead") may already have resolved this in the middleware chain.
  // Reusing it avoids running the webmaster lookups a second time on routes that
  // mount both.
  if (req.scope) return req.scope;
  return resolveScope(req, "lead");
};

export { resolveLeadScope };
