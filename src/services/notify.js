// src/services/notify.js
//
// Single entry point used by every route that needs to message a client.
// Composes the FR/EN/AR message, sends it by email always, and by SMS only
// for the few events where a client genuinely needs to know right away.
// Email is free and unlimited (Gmail SMTP); SMS is billed per segment via
// Twilio, so it's reserved for moments that are actually time-sensitive -
// everything else still reaches the client, just by email only.

const { composeSms, composeEmailHtml, subjects, composeOwnerAlertSms } = require('./messages');
const { sendEmail } = require('./email');
const { sendSms } = require('./sms');

// Event types urgent/important enough to justify an SMS, per the dashboard
// review: "Prêt à travailler avec vous" (a quote is ready), and anything
// going wrong with an active order (late, problem, cancelled, finished as
// a failure). Everything else - including the invoice/order-arrived email,
// which already carries the PDF attachment - is email-only.
const SMS_EVENT_TYPES = new Set([
  'ready_to_work',
  'order_late',
  'order_problem',
  'order_cancelled',
  'finish_failed'
]);

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
    sendEmail(client.email, subject, emailHtml, attachments)
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

/**
 * Alerts the business owner (dad) by SMS that a new quote request came in -
 * separate from notifyClient, which only confirms receipt to the client.
 * Text only, no email, per business decision.
 *
 * Uses OWNER_PHONE - if it's not configured, this is a silent no-op, same
 * pattern as sms.js when its own required env vars are missing, so it
 * never breaks quote creation even before that variable is set.
 *
 * @param {object} client - the just-created Prisma Client record
 */
async function notifyOwnerNewQuote(client) {
  const ownerPhone = process.env.OWNER_PHONE;
  if (!ownerPhone) {
    console.warn('[notify] OWNER_PHONE not configured - skipping owner alert for client', client.id);
    return;
  }
  try {
    await sendSms(ownerPhone, composeOwnerAlertSms(client));
  } catch (err) {
    console.error('[notify] Owner SMS alert failed:', err);
  }
}

module.exports = { notifyClient, notifyOwnerNewQuote };
