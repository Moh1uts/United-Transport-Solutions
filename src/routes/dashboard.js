// src/routes/dashboard.js
const express = require('express');
const router = express.Router();
const prisma = require('../db');
const { requireLogin } = require('../middleware/auth');
const { notifyClient } = require('../services/notify');
const { generateInvoicePdf } = require('../services/invoicePdf');

router.use(requireLogin);

// ---------------------------------------------------------------------------
// List pages
// ---------------------------------------------------------------------------
router.get('/', (req, res) => res.redirect('/potential'));

router.get('/potential', async (req, res) => {
  const clients = await prisma.client.findMany({
    where: { status: 'potential' },
    orderBy: { createdAt: 'desc' }
  });
  res.render('dashboard_list', { clients, category: 'potential', title: 'Clients Potentiels' });
});

router.get('/active', async (req, res) => {
  const clients = await prisma.client.findMany({
    where: { status: 'active' },
    orderBy: { createdAt: 'desc' }
  });
  res.render('dashboard_list', { clients, category: 'active', title: 'Clients Actifs' });
});

router.get('/refused', async (req, res) => {
  const clients = await prisma.client.findMany({
    where: { status: 'refused' },
    orderBy: { createdAt: 'desc' }
  });
  res.render('dashboard_list', { clients, category: 'refused', title: 'Clients Refusés' });
});

router.get('/finished', async (req, res) => {
  const clients = await prisma.client.findMany({
    where: { status: 'finished' },
    orderBy: { createdAt: 'desc' }
  });
  res.render('dashboard_list', { clients, category: 'finished', title: 'Clients Terminés' });
});

// ---------------------------------------------------------------------------
// Manual client creation (phone / email intake)
// ---------------------------------------------------------------------------
router.get('/clients/new', (req, res) => {
  res.render('client_new', { error: null });
});

router.post('/clients', async (req, res) => {
  const b = req.body;
  try {
    const client = await prisma.client.create({
      data: {
        name: b.name,
        phone: b.phone,
        email: b.email,
        city: b.city,
        destination: b.destination,
        nature: b.nature,
        packages: b.packages ? parseInt(b.packages, 10) : null,
        weightKg: b.weightKg ? parseFloat(b.weightKg) : null,
        volume: b.volume || null,
        ice: b.ice || null,
        preferredDate: b.preferredDate || null,
        notes: b.notes || null,
        source: 'manual',
        status: 'potential'
      }
    });

    const result = await notifyClient(client, 'quote_received', {});
    await prisma.event.create({
      data: { clientId: client.id, type: 'quote_received', messageSent: result.bothOk }
    });

    res.redirect(`/clients/${client.id}`);
  } catch (err) {
    console.error(err);
    res.render('client_new', { error: "Impossible de créer le client. Vérifiez les champs et réessayez." });
  }
});

// ---------------------------------------------------------------------------
// Client detail page
// ---------------------------------------------------------------------------
router.get('/clients/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) return res.status(404).send('Client introuvable');

  const events = await prisma.event.findMany({
    where: { clientId: id },
    orderBy: { createdAt: 'desc' }
  });
  const invoices = await prisma.invoice.findMany({
    where: { clientId: id },
    orderBy: { createdAt: 'desc' }
  });

  // For each repeatable action, find the most recent time it was sent, so
  // the template can show "✅ Envoyé le ..." instead of the primary button
  // and avoid accidental double-sends.
  const lastEvents = {};
  for (const e of events) {
    if (!lastEvents[e.type]) lastEvents[e.type] = e.createdAt;
  }

  res.render('client_detail', { client, events, invoices, lastEvents, flash: req.query.flash || null });
});

// ---------------------------------------------------------------------------
// POTENTIAL CLIENTS actions
// ---------------------------------------------------------------------------
router.post('/clients/:id/ready-to-work', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) return res.status(404).send('Not found');

  const pricePerKg = req.body.pricePerKg || '—';
  const result = await notifyClient(client, 'ready_to_work', { pricePerKg });
  await prisma.event.create({ data: { clientId: id, type: 'ready_to_work', messageSent: result.bothOk } });
  res.redirect(`/clients/${id}?flash=Message envoyé`);
});

router.post('/clients/:id/refuse', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const reason = req.body.reason || 'Non précisé';
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) return res.status(404).send('Not found');

  const result = await notifyClient(client, 'refused', { reason });
  await prisma.client.update({ where: { id }, data: { status: 'refused', refusalReason: reason } });
  await prisma.event.create({ data: { clientId: id, type: 'refused', reason, messageSent: result.bothOk } });
  res.redirect(`/clients/${id}?flash=Client refusé et déplacé`);
});

router.post('/clients/:id/rewake', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) return res.status(404).send('Not found');

  const result = await notifyClient(client, 'rewake', {});
  await prisma.event.create({ data: { clientId: id, type: 'rewake', messageSent: result.bothOk } });
  res.redirect(`/clients/${id}?flash=Rappel envoyé`);
});

router.post('/clients/:id/activate', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) return res.status(404).send('Not found');

  await prisma.client.update({ where: { id }, data: { status: 'active' } });
  await prisma.event.create({ data: { clientId: id, type: 'moved_active' } });
  res.redirect(`/clients/${id}?flash=Déplacé vers Clients Actifs`);
});

// ---------------------------------------------------------------------------
// ACTIVE CLIENTS actions
// ---------------------------------------------------------------------------
router.post('/clients/:id/order-received', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) return res.status(404).send('Not found');

  const result = await notifyClient(client, 'order_received', {});
  await prisma.event.create({ data: { clientId: id, type: 'order_received', messageSent: result.bothOk } });
  res.redirect(`/clients/${id}?flash=Enregistré et client notifié`);
});

router.post('/clients/:id/order-shipped', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const flightNumber = req.body.flightNumber || '';
  const lta = req.body.lta || '';
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) return res.status(404).send('Not found');

  await prisma.client.update({ where: { id }, data: { flightNumber, lta } });

  const result = await notifyClient(client, 'order_shipped', { flightNumber, lta });
  await prisma.event.create({ data: { clientId: id, type: 'order_shipped', trackingNumber: `Vol ${flightNumber} / LTA ${lta}`, messageSent: result.bothOk } });
  res.redirect(`/clients/${id}?flash=Client notifié avec le vol et le numéro LTA`);
});

router.post('/clients/:id/order-arrived', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) return res.status(404).send('Not found');

  const flightNumber = req.body.flightNumber || client.flightNumber || '';
  const lta = req.body.lta || client.lta || '';
  const lang = req.body.lang === 'en' ? 'en' : 'fr';
  const designation = req.body.designation || undefined;
  const qte = req.body.qte ? parseFloat(req.body.qte) : 1;
  const montant = parseFloat(req.body.montant || '0');
  const taxType = req.body.taxType === 'taxable' ? 'taxable' : 'nonTaxable';

  const year = new Date().getFullYear();
  const countThisYear = await prisma.invoice.count({
    where: { createdAt: { gte: new Date(`${year}-01-01`) } }
  });
  const invoiceNumber = `${String(countThisYear + 1).padStart(5, '0')}/${String(year).slice(-2)}`;

  const fileBuffer = await generateInvoicePdf({
    lang,
    invoiceNumber,
    date: new Date(),
    flightNumber,
    provenance: client.city,
    destination: client.destination,
    nature: client.nature,
    packages: client.packages,
    lta,
    weightKg: client.weightKg,
    ice: client.ice,
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

  await prisma.invoice.create({
    data: {
      clientId: id,
      invoiceNumber,
      flightNumber,
      lta,
      lang,
      amountHT,
      amountTVA,
      amountTTC,
      fileData: fileBuffer
    }
  });

  const result = await notifyClient(
    client,
    'order_arrived',
    { invoiceNumber },
    [{ filename: `Facture_${invoiceNumber.replace('/', '-')}.pdf`, content: fileBuffer }]
  );
  await prisma.event.create({ data: { clientId: id, type: 'order_arrived', messageSent: result.bothOk } });

  res.redirect(`/clients/${id}?flash=Facture générée et envoyée`);
});

router.post('/clients/:id/resend-invoice', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) return res.status(404).send('Not found');

  const latestInvoice = await prisma.invoice.findFirst({
    where: { clientId: id },
    orderBy: { createdAt: 'desc' }
  });
  if (!latestInvoice) return res.redirect(`/clients/${id}?flash=Aucune facture à renvoyer`);
  if (!latestInvoice.fileData) return res.redirect(`/clients/${id}?flash=Cette ancienne facture n'a pas de fichier - regénérez-en une nouvelle`);

  const result = await notifyClient(
    client,
    'order_arrived',
    { invoiceNumber: latestInvoice.invoiceNumber },
    [{ filename: `Facture_${latestInvoice.invoiceNumber.replace('/', '-')}.pdf`, content: Buffer.from(latestInvoice.fileData) }]
  );
  await prisma.event.create({ data: { clientId: id, type: 'order_arrived', messageSent: result.bothOk } });

  res.redirect(`/clients/${id}?flash=Facture renvoyée`);
});

router.post('/clients/:id/order-late', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const reason = req.body.reason || 'Non précisé';
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) return res.status(404).send('Not found');

  const result = await notifyClient(client, 'order_late', { reason });
  await prisma.event.create({ data: { clientId: id, type: 'order_late', reason, messageSent: result.bothOk } });
  res.redirect(`/clients/${id}?flash=Client notifié du retard`);
});

router.post('/clients/:id/order-problem', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const reason = req.body.reason || 'Non précisé';
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) return res.status(404).send('Not found');

  const result = await notifyClient(client, 'order_problem', { reason });
  await prisma.event.create({ data: { clientId: id, type: 'order_problem', reason, messageSent: result.bothOk } });
  res.redirect(`/clients/${id}?flash=Client notifié du problème`);
});

router.post('/clients/:id/order-cancelled', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const reason = req.body.reason || 'Non précisé';
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) return res.status(404).send('Not found');

  const result = await notifyClient(client, 'order_cancelled', { reason });
  await prisma.event.create({ data: { clientId: id, type: 'order_cancelled', reason, messageSent: result.bothOk } });
  res.redirect(`/clients/${id}?flash=Client notifié de l'annulation`);
});

router.post('/clients/:id/finish-success', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) return res.status(404).send('Not found');

  const result = await notifyClient(client, 'finish_success', {});
  await prisma.client.update({ where: { id }, data: { status: 'finished', outcome: 'success' } });
  await prisma.event.create({ data: { clientId: id, type: 'finish_success', messageSent: result.bothOk } });
  res.redirect(`/clients/${id}?flash=Client remercié et déplacé vers Terminés`);
});

router.post('/clients/:id/finish-failed', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const reason = req.body.reason || 'Non précisé';
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) return res.status(404).send('Not found');

  const result = await notifyClient(client, 'finish_failed', { reason });
  await prisma.client.update({ where: { id }, data: { status: 'finished', outcome: 'failed', outcomeReason: reason } });
  await prisma.event.create({ data: { clientId: id, type: 'finish_failed', reason, messageSent: result.bothOk } });
  res.redirect(`/clients/${id}?flash=Excuses envoyées et déplacé vers Terminés`);
});

// ---------------------------------------------------------------------------
// REFUSED CLIENTS actions
// ---------------------------------------------------------------------------
router.post('/clients/:id/invite-back-same', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) return res.status(404).send('Not found');

  const result = await notifyClient(client, 'invite_back_same', {});
  await prisma.event.create({ data: { clientId: id, type: 'invite_back_same', messageSent: result.bothOk } });
  res.redirect(`/clients/${id}?flash=Invitation envoyée`);
});

router.post('/clients/:id/invite-back-other', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const serviceOffer = req.body.serviceOffer || '';
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) return res.status(404).send('Not found');

  const result = await notifyClient(client, 'invite_back_other', { serviceOffer });
  await prisma.event.create({ data: { clientId: id, type: 'invite_back_other', serviceOffer, messageSent: result.bothOk } });
  res.redirect(`/clients/${id}?flash=Invitation envoyée`);
});

module.exports = router;
