/**
 * Attaches the resource scope to the request.
 *
 * The point is that a controller cannot forget it. Scoping used to be a helper
 * each controller called, and a query that skipped the call returned the whole
 * organization — so forgetting failed *open*. With the scope resolved in the
 * middleware chain, `req.scope.where` is always present, and a controller that
 * spreads it gets the right rows without knowing why.
 *
 * Mount after authenticationContext(), which supplies the organization and the
 * isWebmaster flag this reads.
 */
import { resolveScope } from "../utils/scope.js";
import logger from "../utils/logger.js";

export function withScope(resource) {
  return async (req, res, next) => {
    try {
      const scope = await resolveScope(req, resource);

      if (!scope.ok) {
        return res.status(scope.status).json({ error: scope.error });
      }

      req.scope = scope;
      return next();
    } catch (err) {
      // A scope that cannot be resolved is not permission to read everything.
      logger.error({ err, resource }, "failed to resolve resource scope");
      return res.status(500).json({ error: "Failed to resolve access scope" });
    }
  };
}

/**
 * The scope for a request, for controllers mounted without withScope().
 *
 * Throws rather than returning an open scope, because the alternative — falling
 * back to the organization — is exactly the failure this module exists to
 * prevent, and it would be invisible.
 */
export function requireScope(req) {
  if (!req.scope) {
    throw new Error(
      "req.scope is missing: mount withScope(resource) on this route",
    );
  }
  return req.scope;
}
