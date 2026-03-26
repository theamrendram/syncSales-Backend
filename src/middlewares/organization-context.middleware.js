/**
 * Legacy re-exports — use ./authentication-context.middleware.js directly.
 */
const auth = require("./authentication-context.middleware");

module.exports = {
  resolveActiveOrganization: auth.authenticationContext(),
  authenticationContext: auth.authenticationContext,
  requireOrgPermission: auth.requireOrgPermission,
};
