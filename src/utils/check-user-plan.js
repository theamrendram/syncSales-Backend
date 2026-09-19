const prismaClient = require("./prismaClient");
const { resolveApiKeyPrincipal } = require("./api-key-principal");
const { logLeadOutcome, fingerprintApiKey } = require("./lead-log");
const { isDatabaseUnavailable, sendDatabaseUnavailable } = require("./db-errors");

const checkUserPlan = async (req, res, next) => {
  const timer = req.timer;
  timer?.time("mw:checkUserPlan");
  try {
    // POST /leads/create carries the key in the body, GET /leads/create in the
    // query string.
    const apiKey = req.body?.apiKey ?? req.query?.apiKey;

    // Rejections here are the earliest and most common way a lead is lost, so
    // each one names itself rather than returning a bare status.
    const logFields = { src: "plan-check", keyFp: fingerprintApiKey(apiKey) };

    if (!apiKey) {
      logLeadOutcome(req, {
        ...logFields,
        outcome: "missing_api_key",
        status: 400,
      });
      return res.status(400).json({ error: "API key is required" });
    }
    const principal = await resolveApiKeyPrincipal(apiKey, timer);
    if (!principal) {
      logLeadOutcome(req, {
        ...logFields,
        outcome: "invalid_api_key",
        status: 401,
      });
      return res.status(401).json({ error: "Invalid API key" });
    }
    // Hand the resolved principal to the route handler so it does not re-query.
    req.principal = principal;

    logFields.principalType = principal.type;
    logFields.organizationId = principal.organizationId;

    if (!principal.organizationId) {
      logLeadOutcome(req, {
        ...logFields,
        outcome: "api_key_no_org",
        status: 400,
      });
      return res.status(400).json({
        error: "API key must belong to an organization",
      });
    }

    if (principal.type === "webmaster" && !principal.isActive) {
      logLeadOutcome(req, {
        ...logFields,
        outcome: "webmaster_inactive",
        status: 403,
        actorUserId: principal.actorUserId,
      });
      return res.status(403).json({ error: "Webmaster is inactive" });
    }

    // Usually already loaded alongside the API key lookup; only a webmaster
    // whose plan owner is a different user still needs a round trip here.
    let user = principal.planUser;
    if (!principal.planUserResolved) {
      timer?.time("db:user.findUnique(plan)");
      user = await prismaClient.user.findUnique({
        where: { id: principal.planUserId },
        select: {
          id: true,
          organizationId: true,
          userPlan: {
            select: {
              dailyLeadsLimit: true,
            },
          },
        },
      });
      timer?.timeEnd("db:user.findUnique(plan)");
    }

    timer?.time("db:userPlan.findFirst");
    const orgUserPlan = !user?.userPlan
      ? await prismaClient.userPlan.findFirst({
          where: { organizationId: principal.organizationId },
          orderBy: { createdAt: "desc" },
          select: { dailyLeadsLimit: true },
        })
      : null;
    timer?.timeEnd("db:userPlan.findFirst");

    const effectivePlan = user?.userPlan || orgUserPlan;
    if (!effectivePlan) {
      logLeadOutcome(req, {
        ...logFields,
        outcome: "plan_not_found",
        status: 403,
        planUserId: principal.planUserId,
      });
      return res.status(403).json({ error: "User plan not found" });
    }

    const usageUserId =
      user?.id || principal.planUserId || principal.actorUserId || null;
    if (!usageUserId) {
      logLeadOutcome(req, {
        ...logFields,
        outcome: "invalid_key_owner",
        status: 401,
      });
      return res.status(401).json({ error: "Invalid API key owner" });
    }

    const { dailyLeadsLimit } = effectivePlan;



    if (dailyLeadsLimit === 0) {
      timer?.timeEnd("mw:checkUserPlan");
      next();
      return;
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // Ensure usage row exists only when there is an enforced limit.
    timer?.time("db:leadUsage.upsert");
    const usage = await prismaClient.leadUsage.upsert({
      where: {
        userId_date: {
          userId: usageUserId,
          date: today,
        },
      },
      update: {},
      create: {
        userId: usageUserId,
        date: today,
        count: 0,
        organizationId: principal.organizationId || user?.organizationId,
      },
    });
    timer?.timeEnd("db:leadUsage.upsert");

    if (usage.count >= dailyLeadsLimit) {
      logLeadOutcome(req, {
        ...logFields,
        outcome: "daily_limit_reached",
        status: 429,
        used: usage.count,
        limit: dailyLeadsLimit,
        usageUserId,
      });
      return res.status(429).json({ error: "Daily lead limit reached" });
    }

    timer?.timeEnd("mw:checkUserPlan");
    next();
  } catch (error) {
    // Database down: 503 so the sender retries instead of dropping the lead.
    if (isDatabaseUnavailable(error)) {
      logLeadOutcome(req, {
        src: "plan-check",
        outcome: "db_unavailable",
        status: 503,
        err: error,
      });
      return sendDatabaseUnavailable(req, res);
    }
    logLeadOutcome(req, {
      src: "plan-check",
      outcome: "plan_check_error",
      status: 500,
      err: error,
    });
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

module.exports = { checkUserPlan };
