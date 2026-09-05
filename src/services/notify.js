// src/services/notify.js
//
// Single entry point used by every route that needs to message a client.
// Composes the FR/EN/AR message, sends it by SMS and email, and returns
// whether both sends succeeded (so the caller can log it on the Event).

const { composeSms, composeEmailHtml, subjects } = require('./messages');
const { sendEmail } = require('./email');
const { sendSms } = require('./sms');

/**
 * @param {object} client - Prisma Client record (needs name, phone, email)
 * @param {string} type - one of the keys in messages.js `templates`
 * @param {object} data - extra fields the template needs (reason, trackingNumber, etc.)
 * @param {Array} [attachments] - email attachments, e.g. invoice PDF
 */
async function notifyClient(client, type, data = {}, attachments = []) {
  const mergedData = { name: client.name, ...data };
  const smsBody = composeSms(type, mergedData);
  const emailHtml = composeEmailHtml(type, mergedData);
  const subject = subjects[type] || 'United Transport Solutions';

  const results = await Promise.allSettled([
    sendSms(client.phone, smsBody),
    sendEmail(client.email, subject, emailHtml, attachments)
  ]);

  const smsOk = results[0].status === 'fulfilled';
  const emailOk = results[1].status === 'fulfilled';

  if (!smsOk) console.error('[notify] SMS failed:', results[0].reason);
  if (!emailOk) console.error('[notify] Email failed:', results[1].reason);

  return { smsOk, emailOk, bothOk: smsOk && emailOk };
}

module.exports = { notifyClient };
