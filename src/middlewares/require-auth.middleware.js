/**
 * Session authentication — the Better Auth replacement for Clerk's requireAuth().
 *
 * Deliberately populates `req.auth = { userId }`, the exact shape
 * authentication-context.middleware.js already reads, so the organization and
 * permission layers need no changes when the identity provider swaps out.
 */
import { fromNodeHeaders } from "better-auth/node";
import auth from "../lib/auth.js";
import logger from "../utils/logger.js";

async function readSession(req) {
  return auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
}

/**
 * Rejects unauthenticated requests with 401.
 */
export function requireAuth() {
  return async (req, res, next) => {
    try {
      const session = await readSession(req);

      if (!session?.user?.id) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      req.auth = { userId: session.user.id };
      req.session = session.session;
      req.user = session.user;

      // The organization plugin keeps the active org on the session, which
      // saves authenticationContext a lookup per request.
      if (session.session?.activeOrganizationId) {
        req.activeOrganizationId = session.session.activeOrganizationId;
      }

      next();
    } catch (err) {
      // A failure to *read* a session is not a failure to authenticate, but it
      // must never fall through as authenticated.
      logger.error({ err }, "session resolution failed");
      return res.status(401).json({ error: "Unauthorized" });
    }
  };
}

/**
 * Attaches a session when present and continues either way. For routes that
 * serve both signed-in users and API-key callers.
 */
export function optionalAuth() {
  return async (req, res, next) => {
    try {
      const session = await readSession(req);
      if (session?.user?.id) {
        req.auth = { userId: session.user.id };
        req.session = session.session;
        req.user = session.user;
        if (session.session?.activeOrganizationId) {
          req.activeOrganizationId = session.session.activeOrganizationId;
        }
      }
    } catch (err) {
      logger.warn({ err }, "optional session resolution failed");
    }
    next();
  };
}

export default requireAuth;
