const { createHash } = require("crypto");
const logger = require("./logger");
const getClientIp = require("./get-client-ip");

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

// Support looks a lead up by the last digits the customer quotes, and the
// outcome line stays readable without repeating the whole number.
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

// A rejected lead can only be reproduced from the log if the payload that
// arrived is in it, so the inbound body is written verbatim apart from the API
// key. It carries customer contact details by definition; LOG_LEAD_BODY=false
// switches it off without a deploy.
const leadBodyLoggingEnabled = () => process.env.LOG_LEAD_BODY !== "false";

const MAX_LOGGED_BODY_BYTES = 16 * 1024;

// A non-object payload (array, string) is kept as-is: it is exactly what a
// misconfigured caller sent, and that is what needs reproducing.
const withoutApiKey = (payload) => {
  if (payload == null) return {};
  if (typeof payload !== "object" || Array.isArray(payload)) return payload;
  const { apiKey, ...rest } = payload;
  return rest;
};

// Credentials are the only headers withheld; the rest are needed to tell a
// browser form post from a server-side integration when a payload is malformed.
const SENSITIVE_HEADERS = new Set(["authorization", "cookie", "x-api-key"]);

const withoutSensitiveHeaders = (headers) => {
  if (!headers || typeof headers !== "object") return {};
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!SENSITIVE_HEADERS.has(name.toLowerCase())) out[name] = value;
  }
  return out;
};

// GET /leads/create carries the key in the query string, so the raw URL would
// leak it.
const urlWithoutApiKey = (rawUrl) => {
  if (typeof rawUrl !== "string") return undefined;
  try {
    const parsed = new URL(rawUrl, "http://localhost");
    parsed.searchParams.delete("apiKey");
    return parsed.pathname + parsed.search;
  } catch {
    return rawUrl.split("?")[0];
  }
};

const digitsOnly = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits || undefined;
};

// Everything that arrived. The log line is the only record of a request the
// database never saw, so it has to be enough to replay the lead by hand - which
// is why the API key is printed here, as the one exception to the redaction
// rules in logger.js.
const snapshotLeadRequest = (req, source) => {
  const payload = source === "query" ? req?.query : req?.body;
  const primary = withoutApiKey(payload);
  const isRecord = primary && typeof primary === "object" && !Array.isArray(primary);
  const apiKey = payload?.apiKey ?? req?.headers?.["x-api-key"];

  let ip;
  try {
    ip = getClientIp(req) || undefined;
  } catch {
    ip = undefined;
  }

  return {
    src: source,
    method: req?.method,
    url: urlWithoutApiKey(req?.originalUrl ?? req?.url),
    httpVersion: req?.httpVersion,
    protocol: req?.protocol,
    ip,
    apiKey: scalar(apiKey),
    keyFp: fingerprintApiKey(apiKey),
    campId: isRecord ? scalar(primary.campId) : undefined,
    phone: isRecord ? digitsOnly(primary.phone) : undefined,
    fields: isRecord ? Object.keys(primary) : [],
    headers: withoutSensitiveHeaders(req?.headers),
    query: withoutApiKey(req?.query),
    body: withoutApiKey(req?.body),
    params: req?.params ?? {},
  };
};

// Logged before any validation or rate limiting, so payloads rejected by the
// middleware chain are captured too - those are the ones with no other trace.
const logLeadRequest = (req, source, snapshot = snapshotLeadRequest(req, source)) => {
  if (!leadBodyLoggingEnabled()) return;

  const { body, query, ...rest } = snapshot;
  const bytes = byteLength({ body, query });
  // The request limit is 1mb; a payload that size must not become a log record.
  const oversized = bytes !== undefined && bytes > MAX_LOGGED_BODY_BYTES;

  loggerFor(req).info(
    {
      evt: "lead_request",
      route: req?.timer?.name,
      ...rest,
      bytes,
      body: oversized ? undefined : body,
      query: oversized ? undefined : query,
      truncated: oversized || undefined,
    },
    "lead_request",
  );
};

const leadRequestLogger = (source) => (req, res, next) => {
  logLeadRequest(req, source);
  next();
};

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
  leadRequestLogger,
  logLeadRequest,
  snapshotLeadRequest,
  phoneLast4,
  logLeadOutcome,
  logLeadWebhook,
  summarizeWebhookResponse,
};
