// src/services/sms.js
//
// Sends SMS via Twilio. Requires a Twilio account, a Twilio phone number
// with international SMS sending enabled, and TWILIO_ACCOUNT_SID /
// TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER set in the environment.
//
// IMPORTANT COST/DELIVERABILITY NOTE (read this before going live):
// - A message containing ANY Arabic (or other non-GSM7) character is sent
//   as Unicode (UCS-2), which allows only ~70 characters per SMS segment
//   instead of ~160. Our 3-language messages (FR+EN+AR) will almost always
//   span multiple segments - Twilio bills per segment, and per-segment
//   pricing to Morocco is higher than US pricing. Budget accordingly.
// - Some countries restrict which senders can reach local phones
//   transactionally. Test with a real Moroccan number before relying on
//   this for production. If delivery is unreliable, consider a local SMS
//   gateway/aggregator as an alternative to Twilio for Morocco specifically.

const twilio = require('twilio');

let client = null;
function getClient() {
  if (client) return client;
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) return null;
  client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return client;
}

/**
 * @param {string} to - E.164 phone number, e.g. +2126XXXXXXXX
 * @param {string} body
 */
async function sendSms(to, body) {
  const c = getClient();
  if (!c || !process.env.TWILIO_FROM_NUMBER) {
    console.warn('[sms] Twilio not configured - skipping send. Would have sent to:', to);
    return { skipped: true };
  }
  const message = await c.messages.create({
    to,
    from: process.env.TWILIO_FROM_NUMBER,
    body
  });
  return message;
}

module.exports = { sendSms };
