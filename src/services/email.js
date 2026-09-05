// src/services/email.js
//
// Sends email via Google Workspace SMTP (smtp.gmail.com), using an "App
// Password" - NOT the normal account password. See README section
// "Setting up Google Workspace email sending" for the exact steps to
// generate one; it requires 2-Step Verification to be turned on first.

const nodemailer = require('nodemailer');

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.SMTP_USER, // contact@unitedtransportsolutions.com
      pass: process.env.SMTP_APP_PASSWORD // 16-character App Password
    }
  });
  return transporter;
}

/**
 * @param {string} to - recipient email address
 * @param {string} subject
 * @param {string} html
 * @param {Array<{filename:string, content:Buffer}>} [attachments]
 */
async function sendEmail(to, subject, html, attachments = []) {
  if (!process.env.SMTP_USER || !process.env.SMTP_APP_PASSWORD) {
    console.warn('[email] SMTP_USER / SMTP_APP_PASSWORD not configured - skipping send. Would have sent:', { to, subject });
    return { skipped: true };
  }
  const info = await getTransporter().sendMail({
    from: `"${process.env.COMPANY_NAME || 'United Transport Solutions'}" <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
    attachments
  });
  return info;
}

module.exports = { sendEmail };
