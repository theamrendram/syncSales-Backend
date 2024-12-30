const prismaClient = require("../utils/prismaClient");

const checkDuplicateLead = async (phone, campaign) => {
  const lead_period = campaign.lead_period;
  const lead = await prismaClient.lead.findFirst({
    where: {
      phone,
      campaignId: campaign.id,
    },
  });

  if (lead) {
    if (lead_period) {
      const leadDate = new Date(lead.createdAt);
      const currentDate = new Date();
      const diffTime = Math.abs(currentDate - leadDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      console.log("diffDays", diffDays, "lead_period", lead_period);

      if (diffDays <= lead_period) {
        return true;
      }
    }
  }

  console.log("lead", lead);

  return false;
};

module.exports = { checkDuplicateLead };
