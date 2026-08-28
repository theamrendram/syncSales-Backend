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
  time: "#33D1FF",
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

// Helper to get IST date string (YYYY-MM-DD)
const getISTDateString = (dateInput) => {
  const date = dateInput ? new Date(dateInput) : new Date();
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
};

/**
 * A period's leads and what they are worth, on both bases.
 *
 * `submitted` prices every lead at its route's payout; `earned` counts only the
 * ones the client approved. Keeping both is the whole point — a lead is not
 * money until the buyer says so, and reporting one number for both was how the
 * dashboard came to overstate revenue by everything its clients rejected.
 */
const emptyPeriod = () => ({ leads: 0, earned: 0, submitted: 0 });

const addToPeriod = (period, payout, isApproved) => {
  period.leads += 1;
  period.submitted += payout;
  if (isApproved) period.earned += payout;
};

const round2 = (value) => Math.round(value * 100) / 100;

/**
 * Percentage change, or null when there is no baseline to divide by.
 *
 * Returning 100 for "grew from nothing", as this used to, invents a baseline
 * that never existed and renders as a confident green +100% on the dashboard.
 * Null lets the card omit the badge instead.
 */
const calcTrend = (current, previous) => {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
};

/**
 * Month-scale buckets are only as complete as the loaded window.
 *
 * The caller passes a `days` window (30 by default, 90 at most) and this then
 * reports on "last month" — which a 30-day window cannot cover. Rather than
 * present a partial count as a total, the flags below tell the UI what it is
 * allowed to trust. Fixing this properly means aggregating months in the
 * database rather than over a capped page of leads.
 */
const MIN_DAYS_FOR_LAST_MONTH = 62;
const MIN_DAYS_FOR_MONTH_TREND = 92;

const chartMetrics = (leads, { days = 30 } = {}) => {
  const now = new Date();
  const todayStr = getISTDateString(now);
  
  // Calculate yesterday and other relative dates in IST
  // We construct a date from the string to subtract days safely
  const todayDate = new Date(todayStr); // Treating YYYY-MM-DD as UTC midnight for math checks is safe if consistent
  const yesterdayDate = new Date(todayDate);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = yesterdayDate.toISOString().split('T')[0];
  
  const twoDaysAgoDate = new Date(todayDate);
  twoDaysAgoDate.setDate(twoDaysAgoDate.getDate() - 2);
  const twoDaysAgoStr = twoDaysAgoDate.toISOString().split('T')[0];

  const currentMonthYearStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata", year: 'numeric', month: '2-digit' }).slice(0, 7); // YYYY-MM
  
  // Previous month calculation
  const firstDayThisMonth = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);
  const lastDayLastMonth = new Date(firstDayThisMonth.getTime() - 1);
  const prevMonthYearStr = lastDayLastMonth.toISOString().slice(0, 7); // YYYY-MM

  // The month before that, so "last month" has something real to move against.
  const firstDayLastMonth = new Date(
    lastDayLastMonth.getFullYear(),
    lastDayLastMonth.getMonth(),
    1,
  );
  const twoMonthsAgoStr = new Date(firstDayLastMonth.getTime() - 1)
    .toISOString()
    .slice(0, 7);

  const today = emptyPeriod();
  const yesterday = emptyPeriod();
  const twoDaysAgo = emptyPeriod();
  const lastMonth = emptyPeriod();
  const twoMonthsAgo = emptyPeriod();
  const overall = emptyPeriod();

  let approvedLeads = 0,
    trashLeads = 0,
    duplicateLeads = 0,
    pendingLeads = 0,
    pipelineRevenue = 0;

  const campaignStats = {};
  const pieChartMap = {};

  // 🔥 Single-pass loop
  for (const lead of leads) {
    let leadISTStr;
    try {
      if (!lead.createdAt) continue;
      leadISTStr = getISTDateString(lead.createdAt);
    } catch {
      continue;
    }

    const payout =
      typeof lead?.route?.payout === "number" && !isNaN(lead.route.payout)
        ? lead.route.payout
        : 0;

    // Matched case-insensitively: the postback handler title-cases whatever
    // string the client sent, so `APPROVED` is stored as `APPROVED`.
    const status = String(lead.status ?? "").toLowerCase();
    const isApproved = status === "approved";

    if (isApproved) approvedLeads++;
    else if (status === "trash") trashLeads++;
    else if (status === "duplicate") duplicateLeads++;
    else if (status === "pending") {
      pendingLeads++;
      pipelineRevenue += payout;
    }

    addToPeriod(overall, payout, isApproved);

    // Today
    if (leadISTStr === todayStr) {
      addToPeriod(today, payout, isApproved);
    }
    // Yesterday
    else if (leadISTStr === yesterdayStr) {
      addToPeriod(yesterday, payout, isApproved);
    }
    // Two days ago
    else if (leadISTStr === twoDaysAgoStr) {
      addToPeriod(twoDaysAgo, payout, isApproved);
    }

    // Last month
    // Check if lead's month matches last month
    const leadMonthStr = leadISTStr.slice(0, 7);
    if (leadMonthStr === prevMonthYearStr) {
      addToPeriod(lastMonth, payout, isApproved);
    } else if (leadMonthStr === twoMonthsAgoStr) {
      addToPeriod(twoMonthsAgo, payout, isApproved);
    }

    // Campaign stats (all-time)
    const campaignName = lead.campaign?.name || "Unknown";
    if (!campaignStats[campaignName]) {
      campaignStats[campaignName] = {
        leads: 0,
        revenue: 0,
        submittedRevenue: 0,
        approved: 0,
      };
    }
    campaignStats[campaignName].leads++;
    campaignStats[campaignName].submittedRevenue += payout;
    if (isApproved) {
      campaignStats[campaignName].approved++;
      campaignStats[campaignName].revenue += payout;
    }

    // Pie chart (this month only - IST)
    if (leadMonthStr === currentMonthYearStr) {
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

  // Finalize
  const totalLeads = leads.length;

  /**
   * Approved over the leads a client has actually ruled on.
   *
   * Pending is excluded from the denominator, matching `/reports/statistics`.
   * The old formula divided by every lead, so a healthy client with a backlog
   * of undecided leads read as a rejection problem it did not have.
   */
  const decidedLeads = totalLeads - pendingLeads;
  const approvalRate =
    decidedLeads > 0 ? round2((approvedLeads / decidedLeads) * 100) : 0;

  /** Earned per lead sent — what a lead is actually worth end to end. */
  const averageRevenuePerLead =
    totalLeads > 0 ? round2(overall.earned / totalLeads) : 0;

  const topCampaigns = Object.entries(campaignStats)
    .map(([name, stats]) => ({
      name,
      ...stats,
      revenue: round2(stats.revenue),
      submittedRevenue: round2(stats.submittedRevenue),
    }))
    .sort((a, b) => b.leads - a.leads)
    .slice(0, 5);

  const pieChartData = Object.values(pieChartMap);

  const lastMonthComplete = days >= MIN_DAYS_FOR_LAST_MONTH;
  const monthTrendAvailable = days >= MIN_DAYS_FOR_MONTH_TREND;

  return {
    // Base metrics
    todaysLeads: today.leads,
    yesterdaysLeads: yesterday.leads,
    /** Every lead today at its payout — most are still pending, hence "expected". */
    todaysExpectedRevenue: round2(today.submitted),
    /** Of that, what clients have already approved. */
    todaysEarnedRevenue: round2(today.earned),
    lastMonthLeads: lastMonth.leads,
    lastMonthRevenue: round2(lastMonth.earned),
    lastMonthSubmittedRevenue: round2(lastMonth.submitted),

    /** Approved leads only. What the organization is actually owed. */
    totalRevenue: round2(overall.earned),
    /** Every lead sent at its payout, approved or not. */
    totalSubmittedRevenue: round2(overall.submitted),
    /** Riding on leads no client has ruled on yet. */
    pipelineRevenue: round2(pipelineRevenue),

    totalLeads,
    approvedLeads,
    trashLeads,
    duplicateLeads,
    pendingLeads,
    decidedLeads,
    approvalRate,
    averageRevenuePerLead,

    // Trends (signed %, or null where there is no baseline)
    trends: {
      todayLeads: calcTrend(today.leads, yesterday.leads),
      // Tracks the figure the card displays, which is the expected basis.
      todayRevenue: calcTrend(today.submitted, yesterday.submitted),
      yesterday: calcTrend(yesterday.leads, twoDaysAgo.leads),
      // Was compared against a hard-coded 0, so it always read +100%.
      lastMonth: monthTrendAvailable
        ? calcTrend(lastMonth.leads, twoMonthsAgo.leads)
        : null,
    },

    /**
     * What the loaded window can support. Month-scale figures computed from a
     * 30-day window are partial, and the UI needs to say so rather than
     * present them as totals.
     */
    coverage: {
      windowDays: days,
      lastMonthComplete,
      monthTrendAvailable,
    },

    // Campaign data
    topCampaigns,
    pieChartData,
  };
};

/**
 * Per (date, route, campaign) rollup of the lead window.
 *
 * A lead's status is the client's verdict, posted back to `/api/v1/postback`,
 * so it is the axis every honest revenue figure hangs off. This emits two
 * rather than one:
 *
 *   submittedRevenue — every lead sent, at the route's payout. What the old
 *                      single `revenue` field counted; a lead is only worth
 *                      this much if the client goes on to accept it.
 *   earnedRevenue    — approved leads only. The money actually owed.
 *
 * Statuses are matched case-insensitively. The postback handler title-cases
 * the caller's raw string rather than a normalized one, so a client posting
 * `APPROVED` stores `APPROVED`, not `Approved` — an exact match would drop it.
 */
const generateExtendedReport = (leads) => {
  const reportMap = new Map();

  leads.forEach((lead) => {
    // Use IST date
    const date = getISTDateString(lead.date || lead.createdAt);

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
        // Constant across the group: payout lives on the route, and every lead
        // here shares one.
        payout,
        leads: 0,
        approved: 0,
        trash: 0,
        duplicates: 0,
        pending: 0,
        earnedRevenue: 0,
        submittedRevenue: 0,
      });
    }

    const reportItem = reportMap.get(key);
    reportItem.leads += 1;
    reportItem.submittedRevenue += payout;

    switch (lead.status?.toLowerCase()) {
      case "approved":
        reportItem.approved += 1;
        reportItem.earnedRevenue += payout;
        break;
      case "trash":
        reportItem.trash += 1;
        break;
      case "duplicate":
        reportItem.duplicates += 1;
        break;
      case "pending":
        reportItem.pending += 1;
        break;
    }
  });

  return Array.from(reportMap.values());
};

const transformLeadsToChartData = (leads) => {
  // Group leads by date (IST)
  const leadsByDate = leads.reduce((acc, lead) => {
    const date = getISTDateString(lead.date || lead.createdAt);

    if (!acc[date]) {
      acc[date] = {
        date: date, // Keep YYYY-MM-DD string
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
    const date = getISTDateString(lead.date || lead.createdAt);
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
