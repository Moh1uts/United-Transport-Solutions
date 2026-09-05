// src/routes/monthlyArchive.js
const express = require('express');
const router = express.Router();
const prisma = require('../db');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

const MONTH_NAMES_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];

// List all monthly archives, newest first. Visiting this page also marks
// the latest one as "seen" (dismisses the bell).
router.get('/monthly-archives', async (req, res) => {
  const archives = await prisma.monthlyArchive.findMany({
    orderBy: [{ year: 'desc' }, { month: 'desc' }]
  });

  const unnotified = archives.filter((a) => !a.notified);
  if (unnotified.length > 0) {
    await prisma.monthlyArchive.updateMany({
      where: { id: { in: unnotified.map((a) => a.id) } },
      data: { notified: true }
    });
  }

  res.render('monthly_archives', { archives, monthNames: MONTH_NAMES_FR });
});

router.get('/monthly-archives/:id/download', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const archive = await prisma.monthlyArchive.findUnique({ where: { id } });
  if (!archive) return res.status(404).send('Not found');

  const monthLabel = `${MONTH_NAMES_FR[archive.month - 1]}_${archive.year}`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="Factures_${monthLabel}.zip"`);
  res.send(Buffer.from(archive.zipData));
});

module.exports = router;
