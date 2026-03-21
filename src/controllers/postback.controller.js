const prismaClient = require("../utils/prismaClient");
const { decodePublicOrgLeadId } = require("../utils/org-lead-id");

async function addPostback(req, res) {
  const lead_id = req.query.lead_id;
  const status = req.query.status;
  const apiKey = req.get("x-api-key");

  if (!apiKey) {
    return res.status(401).json({ error: "Missing x-api-key header" });
  }

  if (!lead_id || !status) {
    return res
      .status(400)
      .json({ error: "Missing required fields", required: ["lead_id", "status"] });
  }

  try {
    if (
      !["pending", "approved", "trash", "duplicate"].includes(
        status.toLowerCase()
      )
    ) {
      return res.status(400).json({
        error: "Invalid status",
        valid_statuses: ["pending", "approved", "trash", "duplicate"],
      });
    }

    let orgLeadIdNum;
    try {
      orgLeadIdNum = decodePublicOrgLeadId(String(lead_id));
    } catch {
      return res.status(400).json({ error: "Invalid lead_id" });
    }

    const user = await prismaClient.user.findUnique({
      where: { apiKey },
      select: { organizationId: true },
    });

    if (!user?.organizationId) {
      return res.status(401).json({
        error: "Invalid API key or user not linked to an organization",
      });
    }

    const lead = await prismaClient.lead.findUnique({
      where: {
        organizationId_orgLeadId: {
          organizationId: user.organizationId,
          orgLeadId: orgLeadIdNum,
        },
      },
    });

    if (!lead) {
      return res.status(400).json({ error: "No lead found with this id" });
    }

    const updatedLead = await prismaClient.lead.update({
      where: {
        id: lead.id,
      },
      data: {
        status: status.charAt(0).toUpperCase() + status.slice(1),
      },
    });

    res.status(200).json(updatedLead);
  } catch (error) {
    console.log("error", error);
    res.status(400).json({ error: "There was some error in request" });
  }
}

module.exports = { addPostback };
