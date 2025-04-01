const prismaClient = require("../utils/prismaClient");

async function addPostback(req, res) {
  const lead_id = req.query.lead_id;
  const status = req.query.status;

  try {
    if (
      !["pending", "approved", "trash", "duplicate"].includes(
        status.toLowerCase()
      )
    ) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const lead = await prismaClient.lead.findUnique({
      where: {
        id: lead_id,
      },
    });

    if (!lead) {
      return res.status(400).json({ error: "No lead found" });
    }

    const updatedLead = await prismaClient.lead.update({
      where: {
        id: lead_id,
      },
      data: {
        status: status.charAt(0).toUpperCase() + status.slice(1),
      },
    });

    console.log("lead", updatedLead);
    res.status(200).json(updatedLead);
  } catch (error) {
    console.log("error", error);
    res.status(400).json({ error: "There was some error in request" });
  }
}

module.exports = { addPostback };
