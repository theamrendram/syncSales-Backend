import prismaClient from "../core/prismaClient.js";

// Earliest createdAt that still counts as a duplicate, or null when the
// campaign has no window (every earlier lead with the phone counts).
const duplicateCutoff = (leadPeriod) => {
  if (!leadPeriod) {
    return null;
  }
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - leadPeriod);
  return cutoffDate;
};

const checkDuplicateLead = async (phone, campaign, timer) => {
  const whereClause = {
    phone,
    campaignId: campaign.id,
  };

  const cutoffDate = duplicateCutoff(campaign.lead_period);
  if (cutoffDate) {
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

export { checkDuplicateLead, duplicateCutoff };
