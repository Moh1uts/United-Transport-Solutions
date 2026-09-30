// src/routes/dashboard.js
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const prisma = require('../db');
const { requireLogin } = require('../middleware/auth');
const { notifyClient } = require('../services/notify');
const { generateInvoicePdf } = require('../services/invoicePdf');
const { groupDimensions, formatDimensionGroups } = require('../services/dimensions');
const { COUNTRIES, getAirportsForCountry } = require('../services/airports');

router.use(requireLogin);

// "Smart dimensions" one-line summary ("40 x 30 x 20 cm x3, 50 x 50 x 50 cm")
// for a client, computed server-side and attached to each row before
// rendering a list page - keeps the list views out of EJS-scope trouble
// (see client_detail.ejs's dimGroups, computed the same way).
function withDimSummary(client) {
  const boxes = (Array.isArray(client.dimensions) && client.dimensions.length)
    ? client.dimensions
    : (client.longueur && client.largeur && client.hauteur
        ? [{ longueur: client.longueur, largeur: client.largeur, hauteur: client.hauteur }]
        : []);
  return { ...client, dimSummary: formatDimensionGroups(boxes).join(', ') || '—' };
}

// ---------------------------------------------------------------------------
// Dashboard home - a count per category, each tile linking to that list.
// This is now the landing page (see "/" below and the nav's logo link).
// ---------------------------------------------------------------------------
router.get('/dashboard', async (req, res) => {
  const grouped = await prisma.client.groupBy({ by: ['status'], _count: { status: true } });
  const counts = { potential: 0, waiting: 0, active: 0, refused: 0, finished: 0 };
  grouped.forEach((g) => { counts[g.status] = g._count.status; });

  res.render('dashboard_home', { counts });
});

// ---------------------------------------------------------------------------
// List pages
// ---------------------------------------------------------------------------
router.get('/', (req, res) => res.redirect('/dashboard'));

router.get('/potential', async (req, res) => {
  const clients = await prisma.client.findMany({
    where: { status: 'potential' },
    orderBy: { createdAt: 'desc' }
  });
  res.render('dashboard_list', { clients: clients.map(withDimSummary), category: 'potential', title: 'Demandes Potentielles', flash: req.query.flash || null });
});

// Requests where the tarif has already been sent (ready-to-work) and we're
// waiting on the client to accept or refuse before moving them to Demandes
// Actives. See the /clients/:id/ready-to-work handler below, which is what
// actually moves a client into this status.
router.get('/waiting', async (req, res) => {
  const clients = await prisma.client.findMany({
    where: { status: 'waiting' },
    orderBy: { createdAt: 'desc' }
  });
  res.render('dashboard_list', { clients: clients.map(withDimSummary), category: 'waiting', title: 'Demandes en Attente' });
});

router.get('/active', async (req, res) => {
  const clients = await prisma.client.findMany({
    where: { status: 'active' },
    orderBy: { createdAt: 'desc' }
  });
  res.render('dashboard_list', { clients: clients.map(withDimSummary), category: 'active', title: 'Demandes Actives' });
});

router.get('/refused', async (req, res) => {
  const clients = await prisma.client.findMany({
    where: { status: 'refused' },
    orderBy: { createdAt: 'desc' }
  });
  res.render('dashboard_list', { clients: clients.map(withDimSummary), category: 'refused', title: 'Demandes Refusées' });
});

router.get('/finished', async (req, res) => {
  const clients = await prisma.client.findMany({
    where: { status: 'finished' },
    orderBy: { createdAt: 'desc' },
    include: { invoices: { where: { archived: false }, orderBy: { createdAt: 'desc' } } }
  });
  res.render('dashboard_list', { clients: clients.map(withDimSummary), category: 'finished', title: 'Demandes Terminées' });
});

// ---------------------------------------------------------------------------
// Manual client creation (phone / email intake)
// ---------------------------------------------------------------------------
router.get('/clients/new', (req, res) => {
  res.render('client_new', { error: null, countries: COUNTRIES });
});

// A single box's dimensions coming from the manual creation form's hidden
// dimensions[N][...] fields (submitted as strings by a plain form POST), or
// null if incomplete/invalid. `count` is the "smart dimensions" x-quantity
// field next to each box row - same shape/clamp as src/routes/publicApi.js's
// sanitizeBox, kept as its own copy here since this route parses form-encoded
// fields instead of a JSON body.
function sanitizeBox(box) {
  if (!box || typeof box !== 'object') return null;
  const longueur = parseFloat(box.longueur);
  const largeur = parseFloat(box.largeur);
  const hauteur = parseFloat(box.hauteur);
  if (!longueur || !largeur || !hauteur) return null;
  const rawCount = parseInt(box.count, 10);
  const count = Number.isFinite(rawCount) && rawCount > 1 ? Math.min(rawCount, 500) : 1;
  return { longueur, largeur, hauteur, count };
}

router.post('/clients', async (req, res) => {
  const b = req.body;
  // "destination" stays the combined "City, Country" string every other
  // part of the app (invoices, reports, PDFs) already reads - built from
  // the two split fields so nothing else needs to change. destinationCity/
  // destinationCountry are only used to suggest nearby arrival airports
  // (see services/airports.js) on this request's "Prêt à travailler" form.
  const destinationCity = (b.destinationCity || '').trim();
  const destinationCountry = (b.destinationCountry || '').trim();
  const destination = destinationCity && destinationCountry
    ? `${destinationCity}, ${destinationCountry}`
    : (b.destination || destinationCity || destinationCountry);

  // b.dimensions arrives as an object keyed "0", "1", ... (express's
  // urlencoded parser turns the form's dimensions[N][...] hidden fields into
  // an array-like object) - same "smart dimensions" multi-box + x-quantity
  // support as the public website's form, see services/dimensions.js for how
  // it's grouped/displayed afterward.
  const dimensions = b.dimensions
    ? Object.values(b.dimensions).map(sanitizeBox).filter(Boolean)
    : [];
  const firstBox = dimensions[0] || sanitizeBox({ longueur: b.longueur, largeur: b.largeur, hauteur: b.hauteur });

  try {
    const client = await prisma.client.create({
      data: {
        name: b.name,
        phone: b.phone,
        email: b.email,
        city: b.city,
        destination,
        destinationCity: destinationCity || null,
        destinationCountry: destinationCountry || null,
        nature: b.nature,
        packages: b.packages ? parseInt(b.packages, 10) : null,
        weightKg: b.weightKg ? parseFloat(b.weightKg) : null,
        longueur: firstBox ? firstBox.longueur : null,
        largeur: firstBox ? firstBox.largeur : null,
        hauteur: firstBox ? firstBox.hauteur : null,
        dimensions: dimensions.length > 0 ? dimensions : undefined,
        volume: b.volume || null,
        gerbable: b.gerbable || null,
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
    res.render('client_new', { error: "Impossible de créer la demande. Vérifiez les champs et réessayez.", countries: COUNTRIES });
  }
});

// ---------------------------------------------------------------------------
// Client detail page
// ---------------------------------------------------------------------------
router.get('/clients/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) return res.status(404).send('Demande introuvable');

  const events = await prisma.event.findMany({
    where: { clientId: id },
    orderBy: { createdAt: 'desc' }
  });
  const invoices = await prisma.invoice.findMany({
    where: { clientId: id, archived: false },
    orderBy: { createdAt: 'desc' }
  });

  // For each repeatable action, find the most recent time it was sent, so
  // the template can show "✅ Envoyé le ..." instead of the primary button
  // and avoid accidental double-sends.
  const lastEvents = {};
  for (const e of events) {
    if (!lastEvents[e.type]) lastEvents[e.type] = e.createdAt;
  }

  // "Smart dimensions": collapse identical boxes into one line shown as
  // "x2", "x3", ... Falls back to the legacy single longueur/largeur/hauteur
  // columns for older requests that predate the multi-box "+" button.
  const dimGroups = groupDimensions(
    (Array.isArray(client.dimensions) && client.dimensions.length)
      ? client.dimensions
      : (client.longueur && client.largeur && client.hauteur
          ? [{ longueur: client.longueur, largeur: client.largeur, hauteur: client.hauteur }]
          : [])
  );

  // Suggested arrival airports for the "Prêt à travailler" quote form,
  // narrowed to this client's destination country when we recognize it
  // (see services/airports.js) - e.g. Dallas/Fort Worth for a US client
  // instead of Charles de Gaulle.
  const suggestedAirports = getAirportsForCountry(client.destinationCountry);

  res.render('client_detail', { client, events, invoices, lastEvents, dimGroups, suggestedAirports, flash: req.query.flash || null });
});

// ---------------------------------------------------------------------------
// POTENTIAL CLIENTS actions
// ---------------------------------------------------------------------------
router.post('/clients/:id/ready-to-work', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) return res.status(404).send('Not found');

  // req.body.quotes comes in as an array of {airport, company, direct, tarif}
  // thanks to express.urlencoded({extended:true}) parsing the quotes[0][...]
  // bracket field names from the form. Support a single object too, in case
  // only one quote block was ever submitted and the parser collapses it.
  let quotes = req.body.quotes || [];
  if (!Array.isArray(quotes)) quotes = [quotes];
  quotes = quotes
    .filter(q => q && q.airport && q.company && q.direct && q.tarif)
    .map(q => ({
      airport: q.airport.trim(),
      company: q.company.trim(),
      direct: q.direct.trim(),
      tarif: q.tarif
    }));

  if (quotes.length === 0) {
    return res.redirect(`/clients/${id}?flash=Aucun devis valide fourni`);
  }

  // Human-readable one-line-per-quote summary, stored on the Event for the
  // Historique and reused as the SMS/email template's data.
  const summary = quotes
    .map(q => `${q.airport} — ${q.company} — ${q.direct} — ${q.tarif} DHS/kg TTC`)
    .join(' | ');

  // Fresh token every time a tarif is (re)sent - so an old email's links stop
  // working once a new quote goes out, and the client's previous accept/
  // refuse answer doesn't linger on a new round of pricing.
  const responseToken = crypto.randomBytes(24).toString('hex');

  const result = await notifyClient(client, 'ready_to_work', { quotes, responseToken });
  await prisma.client.update({
    where: { id },
    data: { status: 'waiting', responseToken, clientResponse: null, clientResponseAt: null }
  });
  await prisma.event.create({
    data: { clientId: id, type: 'ready_to_work', reason: summary, messageSent: result.bothOk }
  });
  res.redirect(`/clients/${id}?flash=Devis envoyé — déplacé vers Demandes en Attente`);
});

// Permanently deletes a request - only ever offered (and only ever allowed
// here server-side, regardless of what the form might submit) while the
// request is still "potential" or "waiting": someone we decided not to work
// with, or who never answered a quote. Once a request is active/refused/
// finished it has real history (an order, an invoice, a paper trail) and
// should be moved through the normal status flow instead of erased.
router.post('/clients/:id/delete', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) return res.status(404).send('Not found');

  if (client.status !== 'potential' && client.status !== 'waiting') {
    return res.redirect(`/clients/${id}?flash=Suppression impossible : cette demande n'est plus dans Demandes Potentielles ni Demandes en Attente`);
  }

  const backTo = client.status === 'waiting' ? '/waiting' : '/potential';
  // Cascades to this client's Events (and any Invoices, though a potential/
  // waiting request never has one) - see prisma/schema.prisma onDelete.
  await prisma.client.delete({ where: { id } });
  res.redirect(backTo);
});

router.post('/clients/:id/refuse', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const reason = req.body.reason || 'Non précisé';
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) return res.status(404).send('Not found');

  const result = await notifyClient(client, 'refused', { reason });
  await prisma.client.update({ where: { id }, data: { status: 'refused', refusalReason: reason } });
  await prisma.event.create({ data: { clientId: id, type: 'refused', reason, messageSent: result.bothOk } });
  res.redirect(`/clients/${id}?flash=Demande refusée et déplacée`);
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
  res.redirect(`/clients/${id}?flash=Déplacé vers Demandes Actives`);
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
  const ice = (req.body.ice || '').trim() || client.ice || null;

  // Rapport Cash / margin tracking fields - all optional, calculated client-side
  // and re-derived here since the client-side numbers are just for display.
  const fournisseur = (req.body.fournisseur || '').trim() || null;
  const poidsVol = req.body.poidsVol ? parseFloat(req.body.poidsVol) : null;
  const flatRate = req.body.flatRate === '1';
  const tarifAF = req.body.tarifAF ? parseFloat(req.body.tarifAF) : null;
  const tarifUTS = req.body.tarifUTS ? parseFloat(req.body.tarifUTS) : null;
  const autreFrais = req.body.autreFrais ? parseFloat(req.body.autreFrais) : 0;
  const poidsTaxable = Math.max(client.weightKg || 0, poidsVol || 0);
  const factComp = flatRate
    ? parseFloat(req.body.factComp || '0')
    : Math.round((tarifAF || 0) * poidsTaxable * 100) / 100;
  const facturationUTS = flatRate
    ? parseFloat(req.body.facturationUTS || '0')
    : Math.round((tarifUTS || 0) * poidsTaxable * 100) / 100;
  const netteUTS = Math.round((facturationUTS - factComp - autreFrais) * 100) / 100;

  const year = new Date().getFullYear();
  let invoiceNumber = (req.body.invoiceNumber || '').trim();
  if (!invoiceNumber) {
    const countThisYear = await prisma.invoice.count({
      where: { createdAt: { gte: new Date(`${year}-01-01`) } }
    });
    invoiceNumber = `${String(countThisYear + 1).padStart(5, '0')}/${String(year).slice(-2)}`;
  }

  const fileBuffer = await generateInvoicePdf({
    lang,
    invoiceNumber,
    date: new Date(),
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

  await prisma.invoice.create({
    data: {
      clientId: id,
      invoiceNumber,
      flightNumber,
      lta,
      ice,
      lang,
      amountHT,
      amountTVA,
      amountTTC,
      fournisseur,
      poidsVol,
      flatRate,
      tarifAF,
      tarifUTS,
      factComp,
      facturationUTS,
      autreFrais,
      netteUTS,
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

// A shipment that's already owed money before a real invoice was ever made
// ("Sans Facture" in the old spreadsheet). Creates a lightweight Invoice
// record with no PDF, so it still shows up in Demandes Terminées and
// Recouvrement like a normal invoice. Use "Modifier" later to turn it into
// a real invoice once one is actually generated.
router.post('/clients/:id/add-debt', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) return res.status(404).send('Not found');

  const lta = req.body.lta || client.lta || '';
  const montant = parseFloat(req.body.montant || '0');
  const note = (req.body.note || '').trim() || null;

  await prisma.invoice.create({
    data: {
      clientId: id,
      invoiceNumber: 'S/F',
      lta,
      amountHT: montant,
      amountTVA: 0,
      amountTTC: montant,
      facturationUTS: montant,
      isPlaceholder: true,
      notes: note,
      fileData: null
    }
  });

  res.redirect(`/clients/${id}?flash=Créance sans facture enregistrée${note ? ' — ' + note : ''}`);
});

router.post('/clients/:id/resend-invoice', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) return res.status(404).send('Not found');

  const latestInvoice = await prisma.invoice.findFirst({
    where: { clientId: id, archived: false },
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
  res.redirect(`/clients/${id}?flash=Client remercié et déplacé vers Demandes Terminées`);
});

router.post('/clients/:id/finish-failed', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const reason = req.body.reason || 'Non précisé';
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) return res.status(404).send('Not found');

  const result = await notifyClient(client, 'finish_failed', { reason });
  await prisma.client.update({ where: { id }, data: { status: 'finished', outcome: 'failed', outcomeReason: reason } });
  await prisma.event.create({ data: { clientId: id, type: 'finish_failed', reason, messageSent: result.bothOk } });
  res.redirect(`/clients/${id}?flash=Excuses envoyées et déplacé vers Demandes Terminées`);
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
