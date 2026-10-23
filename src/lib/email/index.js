/**
 * Server-side email, sent through Resend's HTTP API.
 *
 * Ported from home/src/lib/email/email-service.ts, which stayed in the
 * marketing app. Better Auth sends verification, password-reset and
 * organization-invitation mail from the API process, so the transport has to
 * live here.
 *
 * Render blocks outbound SMTP, so mail goes out over HTTPS rather than through
 * an SMTP server.
 */
import logger from "../../utils/core/logger.js";

const RESEND_API = "https://api.resend.com";

/** True when no Resend API key is configured. */
function resendUnconfigured() {
  return !process.env.RESEND_API_KEY;
}

/**
 * One call to the Resend API. Better Auth holds the request open for the send,
 * and fetch on its own waits up to 5 minutes for response headers, so a stalled
 * API would keep the sign-up or invite dialog spinning that long.
 */
async function resendRequest(path, init = {}) {
  const res = await fetch(`${RESEND_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });
  // Errors come back as { statusCode, name, message }; tolerate a non-JSON body.
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

/**
 * Send one message. Rejects on transport failure so callers decide whether a
 * failed send should fail the request — Better Auth treats a throw here as a
 * failed sign-up rather than silently creating an unverifiable account.
 */
export async function sendEmail({ to, subject, html, text, replyTo }) {
  // Without an API key nothing is sent; the action link is logged instead, so
  // the auth flows are fully exercisable locally without a mail account.
  // Refused outright in production, where silently not sending mail is worse
  // than failing loudly.
  if (resendUnconfigured()) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "RESEND_API_KEY is required in production — refusing to use a no-op mail transport",
      );
    }
    const link = (html.match(/https?:\/\/[^\s"'<>]+/g) || [])[0];
    logger.warn({ to, subject, link }, "email NOT delivered (no RESEND_API_KEY) — link logged");
    return { success: true, messageId: null };
  }

  const { res, body } = await resendRequest("/emails", {
    method: "POST",
    // Resend derives the plain-text part from `html` when `text` is omitted.
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "SyncSales <noreply@syncsales.in>",
      to,
      subject,
      html,
      text,
      reply_to: replyTo || process.env.EMAIL_REPLY_TO || undefined,
    }),
  });

  if (!res.ok) {
    logger.error(
      { to, subject, status: res.status, name: body.name, message: body.message },
      "email send failed",
    );
    throw new Error(
      `Resend ${res.status} ${body.name || "error"}: ${body.message || res.statusText}`,
    );
  }

  logger.info({ to, subject, messageId: body.id }, "email sent");
  return { success: true, messageId: body.id };
}

/**
 * Checks the Resend API key without sending anything. Called at boot so a bad
 * mail config surfaces in the logs rather than on a user's first sign-up.
 */
export async function verifyEmailTransport() {
  if (resendUnconfigured()) {
    if (process.env.NODE_ENV === "production") {
      logger.error("RESEND_API_KEY is not set; email cannot be sent");
      return false;
    }
    logger.warn("RESEND_API_KEY not set; emails are logged, not delivered.");
    return true;
  }

  try {
    const { res, body } = await resendRequest("/domains");
    // Listing domains needs a full-access key. A sending-only key, which is
    // what production should hold, gets 401 restricted_api_key: that still
    // proves the key exists and is active. 403 restricted_api_key means the
    // key is inactive.
    if (res.ok || (res.status === 401 && body.name === "restricted_api_key")) {
      logger.info("Resend API key verified");
      return true;
    }
    logger.error(
      { status: res.status, name: body.name, message: body.message },
      "Resend API key verification failed",
    );
    return false;
  } catch (err) {
    logger.error({ err }, "Resend API key verification failed");
    return false;
  }
}
