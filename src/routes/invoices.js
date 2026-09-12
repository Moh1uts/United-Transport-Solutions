// src/routes/invoices.js
const express = require('express');
const router = express.Router();
const prisma = require('../db');
const { requireLogin } = require('../middleware/auth');
const { generateInvoicePdf } = require('../services/invoicePdf');

router.use(requireLogin);

// All stored invoices ("receipts / factures"), newest first. Archived (edited-over)
// versions are hidden here but never deleted - they remain in the database as a record.
router.get('/invoices', async (req, res) => {
  const invoices = await prisma.invoice.findMany({
    where: { archived: false },
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

// Toggle paid/unpaid status for a single invoice, along with how and when it
// was settled (used from "Clients Terminés").
router.post('/invoices/:id/toggle-paid', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) return res.status(404).send('Not found');
  const paid = !!req.body.paid;
  await prisma.invoice.update({
    where: { id },
    data: {
      paid,
      paidMode: paid ? (req.body.paidMode || null) : null,
      paidDate: paid ? (req.body.paidDate ? new Date(req.body.paidDate) : new Date()) : null
    }
  });
  if (req.query.back === 'finished') return res.redirect('/finished');
  res.redirect(`/clients/${invoice.clientId}`);
});

// Show the edit form for an existing invoice, pre-filled with its current values.
router.get('/invoices/:id/edit', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const invoice = await prisma.invoice.findUnique({ where: { id }, include: { client: true } });
  if (!invoice) return res.status(404).send('Not found');
  if (invoice.archived) return res.status(400).send('Cette facture a déjà été remplacée par une version plus récente.');
  res.render('invoice_edit', { invoice });
});

// Process an edit: regenerate the PDF with the corrected values, archive the old
// invoice as a permanent record, and create a new active invoice in its place.
router.post('/invoices/:id/edit', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const oldInvoice = await prisma.invoice.findUnique({ where: { id }, include: { client: true } });
  if (!oldInvoice) return res.status(404).send('Not found');
  if (oldInvoice.archived) return res.status(400).send('Cette facture a déjà été remplacée par une version plus récente.');

  const client = oldInvoice.client;
  const flightNumber = req.body.flightNumber || '';
  const lta = req.body.lta || '';
  const lang = req.body.lang === 'en' ? 'en' : 'fr';
  const designation = req.body.designation || undefined;
  const qte = req.body.qte ? parseFloat(req.body.qte) : 1;
  const montant = parseFloat(req.body.montant || '0');
  const taxType = req.body.taxType === 'taxable' ? 'taxable' : 'nonTaxable';
  const ice = (req.body.ice || '').trim() || null;
  const invoiceNumber = (req.body.invoiceNumber || '').trim() || oldInvoice.invoiceNumber;

  // Rapport Cash / margin tracking fields - editable here now too.
  const fournisseur = (req.body.fournisseur || '').trim() || null;
  const poidsVol = req.body.poidsVol ? parseFloat(req.body.poidsVol) : null;
  const flatRate = req.body.flatRate === '1';
  const tarifAF = req.body.tarifAF ? parseFloat(req.body.tarifAF) : null;
  const tarifUTS = req.body.tarifUTS ? parseFloat(req.body.tarifUTS) : null;
  const factNego = req.body.factNego ? parseFloat(req.body.factNego) : null;
  const autreFrais = req.body.autreFrais ? parseFloat(req.body.autreFrais) : 0;
  const poidsTaxable = Math.max(client.weightKg || 0, poidsVol || 0);
  const factComp = flatRate
    ? parseFloat(req.body.factComp || '0')
    : Math.round((tarifAF || 0) * poidsTaxable * 100) / 100;
  const facturationUTS = flatRate
    ? parseFloat(req.body.facturationUTS || '0')
    : Math.round((tarifUTS || 0) * poidsTaxable * 100) / 100;
  const netteUTS = Math.round((facturationUTS - (factNego || factComp) - autreFrais) * 100) / 100;

  const paid = !!req.body.paid;
  const paidMode = paid ? (req.body.paidMode || null) : null;
  const paidDate = paid ? (req.body.paidDate ? new Date(req.body.paidDate) : (oldInvoice.paidDate || new Date())) : null;

  const fileBuffer = await generateInvoicePdf({
    lang,
    invoiceNumber,
    date: oldInvoice.createdAt,
    clientName: client.name,
    flightNumber,
    provenance: client.city,
    destination: client.destination,
    nature: client.nature,
    packages: client.packages,
    lta,
    weightKg: client.weightKg,
    ice,
    volume: client.volume,
    designation,
    qte,
    montant,
    taxType
  });
  const taxable = taxType === 'taxable' ? montant : 0;
  const nonTaxable = taxType === 'nonTaxable' ? montant : 0;
  const amountHT = Math.round((taxable + nonTaxable) * 100) / 100;
  const amountTVA = Math.round(taxable * 0.20 * 100) / 100;
  const amountTTC = Math.round((amountHT + amountTVA) * 100) / 100;

  await prisma.$transaction([
    prisma.invoice.update({
      where: { id: oldInvoice.id },
      data: { archived: true, editedAt: new Date() }
    }),
    prisma.invoice.create({
      data: {
        clientId: oldInvoice.clientId,
        invoiceNumber,
        fournisseur,
        poidsVol,
        flatRate,
        tarifAF,
        tarifUTS,
        factComp,
        factNego,
        facturationUTS,
        autreFrais,
        netteUTS,
        paid,
        paidMode,
        paidDate,
        flightNumber,
        lta,
        ice,
        lang,
        amountHT,
        amountTVA,
        amountTTC,
        paid: oldInvoice.paid,
        replacesInvoiceId: oldInvoice.id,
        fileData: fileBuffer,
        createdAt: oldInvoice.createdAt
      }
    })
  ]);

  res.redirect(`/invoices?flash=Facture ${invoiceNumber} mise à jour — l'ancienne version est conservée comme archive`);
});

module.exports = router;
