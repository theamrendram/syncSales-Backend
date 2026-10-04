import prismaClient from "../utils/prismaClient.js";
import { decodePublicOrgLeadId } from "../utils/org-lead-id.js";
import { resolveApiKeyPrincipal } from "../utils/api-key-principal.js";
import { LEAD_STATUSES, normalizeLeadStatus } from "../utils/lead-status.js";

/**
 * Status update for one lead, authenticated by API key.
 *
 * A publisher may only touch leads it sent (`Lead.userId` is the key owner).
 * Owners and admins may touch any lead in their organization. Advertisers hold
 * no key and change statuses in the dashboard instead.
 */
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

    const lead = await prismaClient.lead.findFirst({
      where: {
        organizationId: principal.organizationId,
        orgLeadId: orgLeadIdNum,
        ...(principal.role === "publisher" ? { userId: principal.actorUserId } : {}),
      },
      select: { id: true },
    });

    // Another publisher's lead answers the same as a missing one, so the
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
