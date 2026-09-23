// src/services/notify.js
//
// Single entry point used by every route that needs to message a client.
// Composes the FR/EN/AR message, sends it by email always, and by SMS only
// for the few events where a client genuinely needs to know right away.
// Email is free and unlimited (Gmail SMTP); SMS is billed per segment via
// Twilio, so it's reserved for moments that are actually time-sensitive -
// everything else still reaches the client, just by email only.

const path = require('path');
const { composeSms, composeEmailHtml, subjects } = require('./messages');
const { sendEmail } = require('./email');
const { sendSms } = require('./sms');

// Inline logo attached to every outgoing email, referenced from the HTML
// template via cid:uts_logo.png (see messages.js composeEmailHtml). This is
// what actually puts the UTS logo in these emails - Gmail's own
// signature/footer settings don't apply to mail sent programmatically here.
const LOGO_ATTACHMENT = {
  filename: 'uts_logo.png',
  path: path.join(__dirname, '..', 'assets', 'uts_logo.png'),
  cid: 'uts_logo.png'
};

// Event types urgent enough to justify an SMS: invoice/order arrived, and
// anything going wrong (delay, problem). Everything else is email-only.
const SMS_EVENT_TYPES = new Set(['order_arrived', 'order_late', 'order_problem']);

/**
 * @param {object} client - Prisma Client record (needs name, phone, email)
 * @param {string} type - one of the keys in messages.js `templates`
 * @param {object} data - extra fields the template needs (reason, trackingNumber, etc.)
 * @param {Array} [attachments] - email attachments, e.g. invoice PDF
 */
async function notifyClient(client, type, data = {}, attachments = []) {
  const mergedData = { name: client.name, ...data };
  const emailHtml = composeEmailHtml(type, mergedData);
  const subject = subjects[type] || 'United Transport Solutions';
  const shouldSendSms = SMS_EVENT_TYPES.has(type);

  const sends = [
    shouldSendSms
      ? sendSms(client.phone, composeSms(type, mergedData))
      : Promise.resolve({ skipped: true, reason: 'not an urgent event type' }),
    sendEmail(client.email, subject, emailHtml, [LOGO_ATTACHMENT, ...attachments])
  ];
  const results = await Promise.allSettled(sends);

  // If SMS wasn't attempted at all, don't count it as a failure - only
  // "smsOk: true" when it either wasn't needed or actually succeeded.
  const smsOk = !shouldSendSms || results[0].status === 'fulfilled';
  const emailOk = results[1].status === 'fulfilled';

  if (shouldSendSms && results[0].status === 'rejected') console.error('[notify] SMS failed:', results[0].reason);
  if (!emailOk) console.error('[notify] Email failed:', results[1].reason);

  return { smsOk, emailOk, bothOk: smsOk && emailOk, smsSent: shouldSendSms };
}

module.exports = { notifyClient };
