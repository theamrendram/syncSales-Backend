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

function chartMetrics(leads) {
  const today = new Date();
  const formattedToday = today.toISOString().split("T")[0];

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const formattedYesterday = yesterday.toISOString().split("T")[0];

  const firstDayOfThisMonth = new Date(
    today.getFullYear(),
    today.getMonth(),
    1
  );
  const lastDayOfLastMonth = new Date(firstDayOfThisMonth - 1);
  const firstDayOfLastMonth = new Date(
    lastDayOfLastMonth.getFullYear(),
    lastDayOfLastMonth.getMonth(),
    1
  );

  let todaysLeads = 0;
  let yesterdaysLeads = 0;
  let todaysExpectedRevenue = 0;
  let lastMonthLeads = 0;
  let lastMonthRevenue = 0;
  const pieChartMap = {}; // using object for fast lookup

  for (const lead of leads) {
    const leadDateObj = new Date(lead.createdAt);
    const leadDateStr = leadDateObj.toISOString().split("T")[0];

    if (leadDateStr === formattedToday) {
      todaysLeads++;
      todaysExpectedRevenue += lead.route.payout;
    }

    if (leadDateStr === formattedYesterday) {
      yesterdaysLeads++;
    }

    if (
      leadDateObj >= firstDayOfLastMonth &&
      leadDateObj <= lastDayOfLastMonth
    ) {
      lastMonthLeads++;
      lastMonthRevenue += lead.route.payout;
    }

    if (leadDateObj >= firstDayOfThisMonth && leadDateObj <= today) {
      const campaignName = lead.campaign?.name || "other";
      if (!pieChartMap[campaignName]) {
        pieChartMap[campaignName] = {
          campaign: campaignName,
          campLeads: 0,
          fill: assignColor(campaignName),
        };
      }
      pieChartMap[campaignName].campLeads++;
    }
  }

  const pieChartData = Object.values(pieChartMap); // convert object to array

  return {
    todaysLeads,
    todaysExpectedRevenue,
    yesterdaysLeads,
    lastMonthLeads,
    lastMonthRevenue,
    pieChartData,
  };
}

function generateExtendedReport(leads) {
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
}

module.exports = { chartMetrics, generateExtendedReport };

// {date, route, campaign, leads, revenue, duplicates}
