import prismaClient from "../utils/prismaClient.js";

const checkDuplicateLead = async (phone, campaign, timer) => {
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

  timer?.time("db:lead.findFirst(duplicate)");
  const lead = await prismaClient.lead.findFirst({
    where: whereClause,
    select: {
      id: true,
    },
  });
  timer?.timeEnd("db:lead.findFirst(duplicate)");

  return !!lead;
};

export { checkDuplicateLead };
