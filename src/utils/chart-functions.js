const predefinedColors = {
  chrome: "#FF5733",
  safari: "#33FF57",
  firefox: "#5733FF",
  edge: "#FFD133",
  other: "#33D1FF",
  opera: "#FF33A1",
  vivaldi: "#A133FF",
  brave: "#FF8C33",
  tor: "#33FF8C",
  maxthon: "#FF333D",
};

const assignColor = (() => {
  const colorMap = { ...predefinedColors };

  return (campaign) => {
    if (!colorMap[campaign]) {
      colorMap[campaign] = `#${Math.floor(Math.random() * 16777215)
        .toString(16)
        .padStart(6, "0")}`;
    }
    return colorMap[campaign];
  };
})();


const chartMetrics = (leads) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000);

  const firstDayOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDayOfLastMonth = new Date(firstDayOfThisMonth.getTime() - 1);
  const firstDayOfLastMonth = new Date(
    lastDayOfLastMonth.getFullYear(),
    lastDayOfLastMonth.getMonth(),
    1
  );

  // Buckets
  let todaysLeads = 0,
    yesterdaysLeads = 0,
    twoDaysAgoLeads = 0,
    lastMonthLeads = 0,
    todaysRevenue = 0,
    yesterdaysRevenue = 0,
    twoDaysAgoRevenue = 0,
    lastMonthRevenue = 0,
    totalRevenue = 0,
    approvedLeads = 0;

  const campaignStats = {};
  const pieChartMap = {};

  // 🔥 Single-pass loop
  for (const lead of leads) {
    let leadDate;
    try {
      leadDate = new Date(lead.createdAt);
    } catch {
      continue;
    }

    const payout =
      typeof lead?.route?.payout === "number" && !isNaN(lead.route.payout)
        ? lead.route.payout
        : 0;

    totalRevenue += payout;

    if (lead.status?.toLowerCase() === "approved") {
      approvedLeads++;
    }

    // Today
    if (leadDate >= today) {
      todaysLeads++;
      todaysRevenue += payout;
    }
    // Yesterday
    else if (leadDate >= yesterday && leadDate < today) {
      yesterdaysLeads++;
      yesterdaysRevenue += payout;
    }
    // Two days ago
    else if (leadDate >= twoDaysAgo && leadDate < yesterday) {
      twoDaysAgoLeads++;
      twoDaysAgoRevenue += payout;
    }

    // Last month
    if (leadDate >= firstDayOfLastMonth && leadDate <= lastDayOfLastMonth) {
      lastMonthLeads++;
      lastMonthRevenue += payout;
    }

    // Campaign stats (all-time)
    const campaignName = lead.campaign?.name || "Unknown";
    if (!campaignStats[campaignName]) {
      campaignStats[campaignName] = { leads: 0, revenue: 0 };
    }
    campaignStats[campaignName].leads++;
    campaignStats[campaignName].revenue += payout;

    // Pie chart (this month only)
    if (leadDate >= firstDayOfThisMonth && leadDate <= now) {
      const pieCampaign = campaignName || "other";
      if (!pieChartMap[pieCampaign]) {
        pieChartMap[pieCampaign] = {
          campaign: pieCampaign,
          campLeads: 0,
          fill: assignColor(pieCampaign), // assumes your helper exists
        };
      }
      pieChartMap[pieCampaign].campLeads++;
    }
  }

  // Helper for signed trends
  const calcTrend = (current, previous) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
  };

  // Finalize
  const totalLeads = leads.length;
  const conversionRate =
    totalLeads > 0 ? Math.round((approvedLeads / totalLeads) * 10000) / 100 : 0;

  const averageRevenuePerLead =
    totalLeads > 0 ? Math.round((totalRevenue / totalLeads) * 100) / 100 : 0;

  const topCampaigns = Object.entries(campaignStats)
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.leads - a.leads)
    .slice(0, 5);

  const pieChartData = Object.values(pieChartMap);

  return {
    // Base metrics
    todaysLeads,
    yesterdaysLeads,
    todaysExpectedRevenue: todaysRevenue,
    lastMonthLeads,
    lastMonthRevenue,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalLeads,
    conversionRate,
    averageRevenuePerLead,

    // Trends (signed %)
    trends: {
      todayLeads: calcTrend(todaysLeads, yesterdaysLeads),
      todayRevenue: calcTrend(todaysRevenue, yesterdaysRevenue),
      yesterday: calcTrend(yesterdaysLeads, twoDaysAgoLeads),
      lastMonth: calcTrend(lastMonthLeads, 0), // optional: compare with previous month
    },

    // Campaign data
    topCampaigns,
    pieChartData,
  };
};
const generateExtendedReport = (leads) => {
  const reportMap = new Map();

  leads.forEach((lead) => {
    const date = new Date(lead.date).toISOString().split("T")[0];

    // ✅ Safe access using optional chaining and fallback values
    const route = lead.route?.name || "Unknown Route";
    const routeId = lead.route?.routeId || "00";
    const campaign = lead.campaign?.name || "Unknown Campaign";
    const campId = lead.campaign?.campId || "00";
    const payout = lead.route?.payout || 0;

    const key = `${date}|${route}|${campaign}`;

    if (!reportMap.has(key)) {
      reportMap.set(key, {
        date,
        route,
        routeId,
        campaign,
        campId,
        leads: 0,
        revenue: 0,
        duplicates: 0,
        pending: 0,
      });
    }

    const reportItem = reportMap.get(key);
    reportItem.leads += 1;

    if (lead.status === "Duplicate") {
      reportItem.duplicates += 1;
    } else if (lead.status === "Pending") {
      reportItem.pending += 1;
    }

    reportItem.revenue += payout;
  });

  return Array.from(reportMap.values());
};

const transformLeadsToChartData = (leads) => {
  // Group leads by date
  const leadsByDate = leads.reduce((acc, lead) => {
    const date = new Date(lead.date).toISOString().split("T")[0];

    if (!acc[date]) {
      acc[date] = {
        date: lead.date,
        lead: 0,
      };
    }

    // Increment lead count for the date
    acc[date].lead += 1;

    return acc;
  }, {});

  // Convert to array and sort by date
  return Object.values(leadsByDate).sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
};

const getLeadsGroupedByDateRouteCampaign = async (leads) => {
  const grouped = {};

  leads.forEach((lead) => {
    const date = lead.date.toISOString().split("T")[0];
    const routeName = lead.route?.name || "Unknown Route";
    const campaignName = lead.campaign?.name || "Unknown Campaign";

    const key = `${date}_${routeName}`;

    if (!grouped[key]) {
      grouped[key] = {
        date,
        route: routeName,
        campaigns: new Set(),
        count: 0,
      };
    }

    grouped[key].campaigns.add(campaignName);
    grouped[key].count += 1;
  });

  // Convert campaigns Set to Array
  return Object.values(grouped).map((item) => ({
    ...item,
    campaigns: Array.from(item.campaigns),
  }));
};

const calculateChartTrends = (chartData) => {
  if (!chartData || chartData.length === 0) {
    return {
      growthRate: 0,
      peakDay: "",
      averageDailyLeads: 0,
      totalLeads: 0,
    };
  }

  const totalLeads = chartData.reduce(
    (sum, item) => sum + (item.count || 0),
    0
  );
  const averageDailyLeads = totalLeads / chartData.length;

  // Find peak day
  const peakDay = chartData.reduce((max, item) =>
    (item.count || 0) > (max.count || 0) ? item : max
  );

  // Calculate growth rate (comparing first and last week)
  const firstWeek = chartData.slice(0, 7);
  const lastWeek = chartData.slice(-7);

  const firstWeekTotal = firstWeek.reduce(
    (sum, item) => sum + (item.count || 0),
    0
  );
  const lastWeekTotal = lastWeek.reduce(
    (sum, item) => sum + (item.count || 0),
    0
  );

  const growthRate =
    firstWeekTotal > 0
      ? ((lastWeekTotal - firstWeekTotal) / firstWeekTotal) * 100
      : 0;

  return {
    growthRate: Math.round(growthRate * 100) / 100,
    peakDay: peakDay.date || "",
    averageDailyLeads: Math.round(averageDailyLeads * 100) / 100,
    totalLeads,
  };
};
module.exports = {
  chartMetrics,
  calculateChartTrends,
  generateExtendedReport,
  getLeadsGroupedByDateRouteCampaign,
  transformLeadsToChartData,
};

// {date, route, campaign, leads, revenue, duplicates}
