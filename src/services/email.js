// src/services/email.js
//
// Sends email via Resend's HTTPS API (api.resend.com), NOT raw SMTP.
//
// Why: this backend runs on Render, and direct SMTP connections to Gmail
// (smtp.gmail.com, ports 465 and 587) consistently time out from there -
// mail providers commonly block/ignore raw SMTP connections coming from
// cloud-hosting IP ranges as an anti-spam measure, regardless of whether
// the credentials are correct. HTTPS traffic (which this uses) is not
// affected by that, so switching to an HTTP-based email API is the fix.
//
// Setup: sign up at resend.com, verify unitedtransportsolutions.com as a
// sending domain (Resend gives you DNS records to add), then create an API
// key and set it as RESEND_API_KEY in Render's environment variables.

const RESEND_API_URL = 'https://api.resend.com/emails';

/**
 * @param {string} to - recipient email address
 * @param {string} subject
 * @param {string} html
 * @param {Array<{filename:string, content:Buffer|string}>} [attachments] - content is a Buffer or base64 string
 */
async function sendEmail(to, subject, html, attachments = []) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not configured - skipping send. Would have sent:', { to, subject });
    return { skipped: true };
  }

  const fromAddress = process.env.SMTP_USER || 'contact@unitedtransportsolutions.com';
  const fromName = process.env.COMPANY_NAME || 'United Transport Solutions';

  const payload = {
    from: `${fromName} <${fromAddress}>`,
    to: [to],
    subject,
    html
  };

  if (attachments.length) {
    payload.attachments = attachments.map((a) => ({
      filename: a.filename,
      // Resend wants base64 content - convert a Buffer if that's what we got.
      content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : a.content
    }));
  }

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Resend API error ${res.status}: ${errBody}`);
  }

  return res.json();
}

module.exports = { sendEmail };
