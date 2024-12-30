const prismaClient = require("../utils/prismaClient");

async function addPostback(req, res) {
  const lead_id = req.query.lead_id;
  const status = req.query.status;

  try {
    const lead = await prismaClient.lead.findUnique({
      where: {
        id: lead_id,
      },
    });

    if(!lead) {
    res.status(400).json({error: "No lead found"})
    }

    const updatedLead = await prismaClient.lead.update({
      where: {
        id: lead_id,
      },
      data: {
        status,
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
