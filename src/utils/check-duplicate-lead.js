const prismaClient = require("../utils/prismaClient");

const checkDuplicateLead = async (phone, campaign) => {
  const lead_period = campaign.lead_period;

  const whereClause = {
    phone,
    campaignId: campaign.id,
  };

  if (lead_period) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lead_period);
    whereClause.createdAt = {
      gte: cutoffDate,
    };
  }

  const lead = await prismaClient.lead.findFirst({
    where: whereClause,
    select: {
      id: true,
    },
  });

  return !!lead;
};

module.exports = { checkDuplicateLead };
