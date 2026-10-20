import axios from "axios";
import { z } from "zod";
import { config } from "../config/env.js";
import { buildWebhookRequest, getDeliveryFailure } from "../utils/webhooks/sendWebhook.js";
import {
  guardedLookup,
  isBlockedAddressError,
  isBlockedIpLiteral,
} from "../utils/webhooks/outbound-url-guard.js";

const TEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_BODY_PREVIEW_CHARS = 4_000;

const PRIVATE_URL_ERROR =
  "This URL points to a private or local address, which SyncSales can't reach. Use a public URL.";

/**
 * The lead a test request carries. Values come from reserved ranges
 * (555-01xx, example.com, 203.0.113.0/24) so a receiving CRM can spot and drop it.
 */
export const SAMPLE_LEAD = Object.freeze({
  firstName: "Test",
  lastName: "Lead",
  phone: "+15555550123",
  email: "test.lead@example.com",
  address: "123 Example Street",
  country: "US",
  ip: "203.0.113.10",
  sub1: "syncsales-test",
  sub2: "",
  sub3: "",
  sub4: "",
});

const isHttpUrl = (value) => {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

const testWebhookSchema = z.object({
  url: z
    .string({ required_error: "Enter the URL to notify" })
    .trim()
    .max(2048, "The URL is too long")
    .url("Enter a full URL, like https://example.com/leads")
    .refine(isHttpUrl, "The URL must start with http:// or https://"),
  // The methods the route form offers.
  method: z.enum(["GET", "POST"], { message: "Choose GET or POST" }),
  attributes: z
    .array(
      z.object({
        type: z.enum(["header", "body"]),
        param: z.string().max(256),
        value: z.string().max(4096),
        isCustom: z.boolean().optional(),
      }),
      { invalid_type_error: "Parameters must be a list" },
    )
    .max(100, "A route can have at most 100 parameters")
    .default([]),
});

/**
 * Rejects malformed test requests before the rate limiter, so a typo in the
 * URL does not cost the user their one request per window.
 */
export const validateWebhookTest = (req, res, next) => {
  const parsed = testWebhookSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? "Invalid test request" });
  }
  // IP literals can be refused without a DNS lookup, so they are refused here.
  // Local development tests against localhost (e.g. this server's /webhook echo).
  if (config.isProduction && isBlockedIpLiteral(parsed.data.url)) {
    return res.status(400).json({ error: PRIVATE_URL_ERROR });
  }
  res.locals.webhookTest = parsed.data;
  return next();
};

const describeRequestError = (error) => {
  const code = error?.code ?? error?.cause?.code;
  switch (code) {
    case "ECONNABORTED":
    case "ETIMEDOUT":
      return `No response within ${TEST_TIMEOUT_MS / 1000} seconds.`;
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "The domain could not be found.";
    case "ECONNREFUSED":
      return "The server refused the connection.";
    case "ECONNRESET":
    case "EPIPE":
      return "The connection closed before a response arrived.";
    case "ERR_BAD_RESPONSE":
      return /maxContentLength/i.test(error?.message ?? "")
        ? `The response was larger than ${MAX_RESPONSE_BYTES / 1024} KB.`
        : error.message;
    case "ERR_INVALID_CHAR":
    case "ERR_INVALID_HTTP_TOKEN":
      return "A header name or value contains characters HTTP doesn't allow.";
    case "CERT_HAS_EXPIRED":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return `The server's TLS certificate was rejected (${code}).`;
    default:
      return error?.message || "The request failed.";
  }
};

const toText = (data) => {
  if (data === undefined || data === null) return "";
  return typeof data === "string" ? data : JSON.stringify(data);
};

// A real delivery lets axios parse the body: JSON when it parses, text otherwise.
const parseLikeDelivery = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/**
 * Whether a real delivery getting this response would be recorded as
 * delivered. `delivered: null` for redirects, which real deliveries follow.
 */
const deliveryVerdict = (status, text) => {
  if (status >= 300 && status < 400) return { delivered: null };
  // A real delivery's axios call rejects these before sendWebhook's checks run.
  if (status < 200 || status >= 300) {
    return { delivered: false, reason: `Request failed with status code ${status}` };
  }
  try {
    const failure = getDeliveryFailure({ status, data: parseLikeDelivery(text) });
    return failure ? { delivered: false, reason: String(failure) } : { delivered: true };
  } catch (error) {
    // e.g. a JSON `null` body, which a real delivery also fails on.
    return { delivered: false, reason: error.message };
  }
};

/**
 * POST /api/v1/routes/test-webhook
 *
 * Sends one request to a route's endpoint, built exactly like a real delivery
 * (buildWebhookRequest) but with SAMPLE_LEAD, and reports what came back.
 * The remote endpoint's own failures are results (200), not errors: the test
 * itself worked.
 */
export const testWebhook = async (req, res) => {
  const { url, method, attributes } = res.locals.webhookTest;
  // Only the host is logged: query strings on webhook URLs often carry tokens.
  const host = new URL(url).hostname;
  const allowPrivate = !config.isProduction;

  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);

  try {
    const response = await axios({
      ...buildWebhookRequest({ url, method, attributes }, SAMPLE_LEAD),
      timeout: TEST_TIMEOUT_MS,
      // A redirect is reported rather than followed, so it cannot hop the
      // request onto a host the guard never saw.
      maxRedirects: 0,
      maxContentLength: MAX_RESPONSE_BYTES,
      validateStatus: () => true,
      responseType: "text",
      transformResponse: [(data) => data],
      ...(allowPrivate ? {} : { lookup: guardedLookup }),
    });

    const durationMs = elapsed();
    const body = toText(response.data);
    const location = response.status >= 300 && response.status < 400
      ? response.headers?.location
      : undefined;

    req.log.info(
      { host, method, httpStatus: response.status, durationMs },
      "Webhook test sent",
    );

    return res.status(200).json({
      success: true,
      data: {
        outcome: "response",
        status: response.status,
        durationMs,
        body: body.slice(0, MAX_BODY_PREVIEW_CHARS),
        truncated: body.length > MAX_BODY_PREVIEW_CHARS,
        ...deliveryVerdict(response.status, body),
        ...(location ? { location } : {}),
      },
    });
  } catch (error) {
    if (isBlockedAddressError(error)) {
      req.log.warn({ host }, "Webhook test blocked: private address");
      return res.status(400).json({ error: PRIVATE_URL_ERROR });
    }

    const durationMs = elapsed();
    req.log.info(
      { host, method, durationMs, code: error?.code ?? error?.cause?.code },
      "Webhook test failed",
    );

    return res.status(200).json({
      success: true,
      data: { outcome: "error", error: describeRequestError(error), durationMs },
    });
  }
};
