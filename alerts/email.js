// Email via SendGrid. Reuses Mary's existing billing@childrenscenterinc.com sender.
// If SENDGRID_API_KEY is missing, logs the email instead of failing - useful for local dev.

const sgMail = require('@sendgrid/mail');

const FROM = process.env.SENTINEL_FROM_EMAIL || 'billing@childrenscenterinc.com';
const TO = process.env.SENTINEL_TO_EMAIL || 'mary@childrenscenterinc.com';

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

async function sendEmail(subject, body, toOverride) {
  if (!process.env.SENDGRID_API_KEY) {
    console.log('[EMAIL - DRY RUN]', { subject, body });
    return { dryRun: true };
  }
  const msg = {
    to: toOverride || TO,
    from: FROM,
    subject,
    text: body,
    html: `<pre style="font-family: ui-monospace, monospace; font-size: 13px;">${escapeHtml(body)}</pre>`
  };
  const [res] = await sgMail.send(msg);
  return { statusCode: res.statusCode };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = { sendEmail };
