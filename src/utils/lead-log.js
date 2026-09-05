const { createHash } = require("crypto");
const logger = require("./logger");

const MAX_LOGGED_STRING = 120;

// API keys must never reach the log store, but attempts still have to be
// groupable by caller, so log a stable short digest instead. The same digest
// can be recomputed locally to match a key against the database.
const fingerprintApiKey = (apiKey) => {
  if (typeof apiKey !== "string") return undefined;
  const normalized = apiKey.trim();
  if (!normalized) return undefined;
  return createHash("sha256").update(normalized).digest("hex").slice(0, 8);
};

// Support looks a lead up by the last digits the customer quotes; the full
// number is redacted by the logger and lives only in the database.
const phoneLast4 = (phone) => {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits ? digits.slice(-4) : undefined;
};

const levelForStatus = (status) => {
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  return "info";
};

const scalar = (value) => {
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.slice(0, MAX_LOGGED_STRING);
  return undefined;
};

const byteLength = (value) => {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? "");
  } catch {
    return undefined;
  }
};

// Every webhook target has its own response schema, so pull only the two fields
// that identify the lead downstream. The body itself is never logged: it is
// already persisted on Lead.webhookResponse and routinely carries customer PII.
const summarizeWebhookResponse = (data) => {
  if (!data || typeof data !== "object") {
    return { remoteStatus: scalar(data) };
  }

  const nested = typeof data.data === "object" && data.data ? data.data : {};
  return {
    remoteId: scalar(nested.id ?? data.id ?? data.name ?? data.lead_id),
    remoteStatus: scalar(data.status_message ?? data.message ?? data.status),
  };
};

const loggerFor = (req) => req?.log || logger;

// One line per lead attempt, carrying its terminal outcome. Render splits log
// entries on newlines, so everything about an attempt has to fit one record.
const logLeadOutcome = (req, { outcome, status, level, err, ...fields }) => {
  const timer = req?.timer;
  // This line is terminal for the attempt, so close any stage still running
  // and report the complete set.
  timer?.endAll?.();
  const stages = timer?.stages?.();

  loggerFor(req)[level || levelForStatus(status)](
    {
      evt: "lead_create",
      outcome,
      status,
      route: timer?.name,
      durationMs: timer?.elapsed?.(),
      ...(stages && Object.keys(stages).length ? { stages } : {}),
      ...fields,
      ...(err ? { err } : {}),
    },
    `lead_create:${outcome}`,
  );
};

// The webhook leg runs after the response has been sent, so it needs its own
// line; without one a failure cannot be tied back to a lead.
const logLeadWebhook = (log, { lead, route, httpStatus, durationMs, data, err }) => {
  const ok = !err;
  const summary = summarizeWebhookResponse(data);
  let host;
  try {
    host = route?.url ? new URL(route.url).host : undefined;
  } catch {
    host = undefined;
  }

  (log || logger)[ok ? "info" : "warn"](
    {
      evt: "lead_webhook",
      ok,
      leadId: lead?.id,
      orgLeadId: lead?.orgLeadId,
      campaignId: lead?.campaignId,
      routeId: lead?.routeId,
      localStatus: lead?.status,
      host,
      method: route?.method,
      httpStatus,
      durationMs,
      bytes: data === undefined ? undefined : byteLength(data),
      ...summary,
      ...(err ? { err } : {}),
    },
    ok ? "lead_webhook:ok" : "lead_webhook:failed",
  );
};

module.exports = {
  fingerprintApiKey,
  phoneLast4,
  logLeadOutcome,
  logLeadWebhook,
  summarizeWebhookResponse,
};
