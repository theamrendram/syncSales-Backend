/**
 * Public postback / API token: base36 uppercase of per-org integer orgLeadId.
 */

function encodePublicOrgLeadId(n) {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error("orgLeadId must be a positive integer");
  }
  return n.toString(36).toUpperCase();
}

function decodePublicOrgLeadId(s) {
  if (typeof s !== "string" || !s.trim()) {
    throw new Error("invalid lead_id");
  }
  const normalized = s.trim().toUpperCase();
  if (!/^[0-9A-Z]+$/.test(normalized)) {
    throw new Error("invalid lead_id");
  }
  const n = parseInt(normalized, 36);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error("invalid lead_id");
  }
  return n;
}

module.exports = { encodePublicOrgLeadId, decodePublicOrgLeadId };
