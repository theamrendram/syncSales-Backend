/**
 * Transactional email templates for the auth flows.
 *
 * Plain, table-free HTML with inline styles — the only thing that renders
 * predictably across mail clients. Every template also carries the raw URL in
 * the body, because a fair number of clients strip or rewrite buttons.
 */

const BRAND = "SyncSales";

function layout({ heading, body, actionUrl, actionLabel, footer }) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f6f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#141f1d;">
    <div style="max-width:520px;margin:0 auto;padding:32px 24px;">
      <div style="font-size:15px;font-weight:700;letter-spacing:-0.01em;color:#0b6e63;margin-bottom:24px;">${BRAND}</div>
      <div style="background:#ffffff;border:1px solid #dce4e1;border-radius:6px;padding:28px;">
        <h1 style="margin:0 0 14px;font-size:19px;line-height:1.3;font-weight:600;">${heading}</h1>
        <div style="font-size:15px;line-height:1.6;color:#3d4d4a;">${body}</div>
        <div style="margin:26px 0 18px;">
          <a href="${actionUrl}" style="display:inline-block;background:#0b6e63;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:11px 22px;border-radius:5px;">${actionLabel}</a>
        </div>
        <p style="margin:0;font-size:13px;line-height:1.5;color:#6b7c78;">
          If the button does not work, paste this into your browser:<br>
          <span style="word-break:break-all;color:#0b6e63;">${actionUrl}</span>
        </p>
      </div>
      <p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:#849691;">${footer}</p>
    </div>
  </body>
</html>`;
}

export function verifyEmailTemplate({ name, url }) {
  return {
    subject: `Confirm your ${BRAND} email address`,
    html: layout({
      heading: "Confirm your email address",
      body: `<p style="margin:0;">${name ? `Hi ${name}, o` : "O"}ne step left. Confirm this address to activate your ${BRAND} account.</p>`,
      actionUrl: url,
      actionLabel: "Confirm email address",
      footer: `If you did not create a ${BRAND} account, you can ignore this message and nothing will happen.`,
    }),
  };
}

export function resetPasswordTemplate({ name, url }) {
  return {
    subject: `Reset your ${BRAND} password`,
    html: layout({
      heading: "Reset your password",
      body: `<p style="margin:0;">${name ? `Hi ${name}, w` : "W"}e received a request to set a new password for your ${BRAND} account. This link expires in one hour.</p>`,
      actionUrl: url,
      actionLabel: "Set a new password",
      footer:
        "If you did not request this, ignore the message — your current password stays active and unchanged.",
    }),
  };
}

export function organizationInviteTemplate({
  organizationName,
  inviterName,
  url,
}) {
  const who = inviterName ? `${inviterName} invited you` : "You have been invited";
  return {
    subject: `${who} to ${organizationName} on ${BRAND}`,
    html: layout({
      heading: `Join ${organizationName}`,
      body: `<p style="margin:0;">${who} to join <strong>${organizationName}</strong> on ${BRAND}. Accept the invitation to get access to their leads and campaigns.</p>`,
      actionUrl: url,
      actionLabel: "Accept invitation",
      footer: `If you were not expecting this invitation, you can safely ignore it.`,
    }),
  };
}
