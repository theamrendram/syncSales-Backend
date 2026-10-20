/**
 * The statuses a lead can be moved to, as stored.
 *
 * Shared by the dashboard update and the postback so the two cannot accept
 * different vocabularies.
 */
export const LEAD_STATUSES = ["Pending", "Approved", "Trash", "Duplicate"];

/** Canonical stored form of a status, or null when it is not one of ours. */
export function normalizeLeadStatus(value) {
  if (typeof value !== "string") return null;
  const wanted = value.trim().toLowerCase();
  return LEAD_STATUSES.find((s) => s.toLowerCase() === wanted) ?? null;
}
