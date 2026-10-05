import prismaClient from "../utils/prismaClient.js";
import { decodePublicOrgLeadId } from "../utils/org-lead-id.js";
import { resolveApiKeyPrincipal } from "../utils/api-key-principal.js";
import { LEAD_STATUSES, normalizeLeadStatus } from "../utils/lead-status.js";
import { getGrantedLeadScope } from "../utils/resource-grants.js";

/**
 * Status update for one lead, authenticated by API key.
 *
 * The owner may touch any lead in their organization. A publisher may only
 * touch leads it sent (`Lead.userId` is the key owner). An advertiser may touch
 * leads in the campaigns or routes assigned to it, which is what it sees in the
 * dashboard. Nobody else holds a key (see resolveApiKeyPrincipal).
 */

/** The lead filter a key's role allows, beyond its organization. */
async function postbackScope(principal) {
  if (principal.role === "owner") return {};
  if (principal.role === "publisher") return { userId: principal.actorUserId };
  if (principal.role === "advertiser") {
    const { campaignIds, routeIds } = await getGrantedLeadScope(
      principal.actorUserId,
      principal.organizationId,
    );
    return {
      OR: [{ campaignId: { in: campaignIds } }, { routeId: { in: routeIds } }],
    };
  }
  return null;
}
async function addPostback(req, res) {
  const lead_id = req.query.lead_id;
  const apiKey = req.get("x-api-key");

  if (!apiKey) {
    return res.status(401).json({ error: "Missing x-api-key header" });
  }

  if (!lead_id || !req.query.status) {
    return res
      .status(400)
      .json({ error: "Missing required fields", required: ["lead_id", "status"] });
  }

  const status = normalizeLeadStatus(req.query.status);
  if (!status) {
    return res.status(400).json({
      error: "Invalid status",
      valid_statuses: LEAD_STATUSES.map((s) => s.toLowerCase()),
    });
  }

  let orgLeadIdNum;
  try {
    orgLeadIdNum = decodePublicOrgLeadId(String(lead_id));
  } catch {
    return res.status(400).json({ error: "Invalid lead_id" });
  }

  try {
    const principal = await resolveApiKeyPrincipal(apiKey);
    if (!principal?.organizationId) {
      return res.status(401).json({
        error: "Invalid API key or user not linked to an organization",
      });
    }

    const scope = await postbackScope(principal);
    const lead = scope && await prismaClient.lead.findFirst({
      where: {
        organizationId: principal.organizationId,
        orgLeadId: orgLeadIdNum,
        ...scope,
      },
      select: { id: true },
    });

    // A lead outside the key's scope answers the same as a missing one, so the
    // response does not confirm which ids exist.
    if (!lead) {
      return res.status(404).json({ error: "No lead found with this id" });
    }

    const updatedLead = await prismaClient.lead.update({
      where: { id: lead.id },
      data: { status },
      select: { status: true, updatedAt: true },
    });

    req.log.info(
      { evt: "postback", leadId: lead.id, status, role: principal.role },
      "postback applied",
    );
    return res.status(200).json({ lead_id, ...updatedLead });
  } catch (err) {
    req.log.error({ evt: "postback", err }, "postback failed");
    return res.status(500).json({ error: "There was some error in request" });
  }
}

export { addPostback };
