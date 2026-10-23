/**
 * Legacy re-exports — use ./authentication-context.middleware.js directly.
 */
import * as auth from "./authentication-context.middleware.js";

export const resolveActiveOrganization = auth.authenticationContext();
export const authenticationContext = auth.authenticationContext;
export const requireOrgPermission = auth.requireOrgPermission;
