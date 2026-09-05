// src/routes/invoices.js
const express = require('express');
const router = express.Router();
const prisma = require('../db');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

// All stored invoices ("receipts / factures"), newest first.
router.get('/invoices', async (req, res) => {
  const invoices = await prisma.invoice.findMany({
    include: { client: true },
    orderBy: { createdAt: 'desc' }
  });
  res.render('invoices', { invoices });
});

router.get('/invoices/:id/download', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) return res.status(404).send('Not found');
  if (!invoice.fileData) return res.status(404).send('Cette ancienne facture (générée avant la mise à jour) n\'a pas de fichier associé.');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Facture_${invoice.invoiceNumber.replace('/', '-')}.pdf"`);
  res.send(Buffer.from(invoice.fileData));
});

module.exports = router;
