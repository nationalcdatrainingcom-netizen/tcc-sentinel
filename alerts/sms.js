// SMS via Twilio. Requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER,
// and MARY_PHONE_NUMBER env vars. If any are missing, logs instead of failing.

const twilio = require('twilio');

let client = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

async function sendSms(message) {
  if (!client) {
    console.log('[SMS - DRY RUN]', message);
    return { dryRun: true };
  }
  const from = process.env.TWILIO_FROM_NUMBER;
  const to = process.env.MARY_PHONE_NUMBER;
  if (!from || !to) {
    console.log('[SMS - NO NUMBERS]', message);
    return { skipped: true };
  }
  // SMS truncation - hard limit at 300 chars so we don't send 10-part messages
  const truncated = message.length > 300 ? message.slice(0, 297) + '...' : message;
  const res = await client.messages.create({ body: truncated, from, to });
  return { sid: res.sid };
}

module.exports = { sendSms };
