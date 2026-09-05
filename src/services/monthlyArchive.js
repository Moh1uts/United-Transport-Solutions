// src/services/monthlyArchive.js
//
// Once a month has fully ended, bundle every invoice generated during that
// month into a single downloadable zip and flag it as "ready" so the bell
// icon in the dashboard lights up.
//
// There's no real cron scheduler on Render's free tier (that's a paid add-on),
// so this uses a "lazy" trigger instead: ensureMonthlyArchiveGenerated() is
// called at the top of the main dashboard pages, and it checks whether last
// month already has an archive. If not - and last month has genuinely ended -
// it generates one right then. In practice, for a business checked daily,
// this fires within minutes of the 1st of the month, which is good enough
// without needing Render's paid Cron Jobs feature.

const AdmZip = require('adm-zip');
const prisma = require('../db');

/**
 * Checks whether last month's archive exists yet, and creates it if not.
 * Safe to call on every request - does nothing once the archive exists.
 */
async function ensureMonthlyArchiveGenerated() {
  const now = new Date();
  // "Last month" relative to today - this is always a fully-completed month.
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const year = lastMonthDate.getFullYear();
  const month = lastMonthDate.getMonth() + 1; // 1-12

  const existing = await prisma.monthlyArchive.findUnique({
    where: { year_month: { year, month } }
  });
  if (existing) return; // already generated

  const rangeStart = new Date(year, month - 1, 1);
  const rangeEnd = new Date(year, month, 1); // first day of the following month

  const invoices = await prisma.invoice.findMany({
    where: { createdAt: { gte: rangeStart, lt: rangeEnd }, fileData: { not: null } },
    include: { client: true }
  });

  // Nothing to archive yet (no invoices that month) - don't create an empty
  // archive/notification; wait until there's actually something to bundle.
  if (invoices.length === 0) return;

  const zip = new AdmZip();
  for (const inv of invoices) {
    const safeName = (inv.client && inv.client.name ? inv.client.name : 'client').replace(/[^a-zA-Z0-9 _-]/g, '');
    const filename = `Facture_${inv.invoiceNumber.replace('/', '-')}_${safeName}.pdf`;
    zip.addFile(filename, Buffer.from(inv.fileData));
  }

  await prisma.monthlyArchive.create({
    data: {
      year,
      month,
      invoiceCount: invoices.length,
      zipData: zip.toBuffer(),
      notified: false
    }
  });
}

module.exports = { ensureMonthlyArchiveGenerated };
