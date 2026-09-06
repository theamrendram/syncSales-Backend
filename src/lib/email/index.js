/**
 * Server-side email.
 *
 * Ported from home/src/lib/email/email-service.ts, which stayed in the
 * marketing app. Better Auth sends verification, password-reset and
 * organization-invitation mail from the API process, so the transport has to
 * live here.
 */
import nodemailer from "nodemailer";
import logger from "../../utils/logger.js";

let transporter = null;

/** True when no SMTP credentials are configured. */
function smtpUnconfigured() {
  return !process.env.SMTP_USER || !process.env.SMTP_PASS;
}

function getTransporter() {
  if (transporter) return transporter;

  // Without SMTP credentials, fall back to nodemailer's jsonTransport: it
  // "sends" into an object instead of over the network. Verification and
  // password-reset links then appear in the logs, so the auth flows are fully
  // exercisable locally without a mail account. Refused outright in production,
  // where silently not sending mail is worse than failing loudly.
  if (smtpUnconfigured()) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "SMTP_USER and SMTP_PASS are required in production — refusing to start with a no-op mail transport",
      );
    }
    logger.warn(
      "SMTP not configured; using jsonTransport. Emails are logged, not delivered.",
    );
    transporter = nodemailer.createTransport({ jsonTransport: true });
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  return transporter;
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Send one message. Rejects on transport failure so callers decide whether a
 * failed send should fail the request — Better Auth treats a throw here as a
 * failed sign-up rather than silently creating an unverifiable account.
 */
export async function sendEmail({ to, subject, html, text, replyTo }) {
  const from =
    process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@syncsales.in";

  const info = await getTransporter().sendMail({
    from,
    to: Array.isArray(to) ? to.join(", ") : to,
    subject,
    html,
    text: text || stripHtml(html),
    replyTo,
  });

  if (smtpUnconfigured()) {
    // The whole point of the dev transport: surface the action link, which is
    // otherwise only reachable through a real inbox.
    const link = (html.match(/https?:\/\/[^\s"'<>]+/g) || [])[0];
    logger.warn({ to, subject, link }, "email NOT delivered (no SMTP) — link logged");
  } else {
    logger.info({ to, subject, messageId: info.messageId }, "email sent");
  }
  return { success: true, messageId: info.messageId };
}

/**
 * Checks SMTP credentials without sending anything. Called at boot so a bad
 * mail config surfaces in the logs rather than on a user's first sign-up.
 */
export async function verifyEmailTransport() {
  try {
    await getTransporter().verify();
    logger.info("SMTP transport verified");
    return true;
  } catch (err) {
    logger.error({ err }, "SMTP transport verification failed");
    return false;
  }
}
