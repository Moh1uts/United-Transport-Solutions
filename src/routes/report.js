// src/routes/report.js
const express = require('express');
const router = express.Router();
const prisma = require('../db');
const { requireLogin } = require('../middleware/auth');
const { generateMonthlyReportPdf } = require('../services/report');
const { generateFacturesExcel, generateCashExcel, generateRecouvrementExcel } = require('../services/excelReports');

router.use(requireLogin);

function monthBounds(monthParam) {
  // monthParam like "2026-09"; defaults to current month
  const now = new Date();
  const [y, m] = (monthParam || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`).split('-').map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 1);
  const label = start.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return { start, end, label, monthParam: `${y}-${String(m).padStart(2, '0')}` };
}

async function computeReportData(monthParam) {
  const { start, end, label } = monthBounds(monthParam);

  const invoicesRaw = await prisma.invoice.findMany({
    where: { createdAt: { gte: start, lt: end } },
    include: { client: true },
    orderBy: { createdAt: 'asc' }
  });
  const invoices = invoicesRaw.map((i) => ({
    invoiceNumber: i.invoiceNumber,
    clientName: i.client.name,
    amountTTC: i.amountTTC,
    createdAt: i.createdAt
  }));
  const totalRevenue = invoices.reduce((sum, i) => sum + i.amountTTC, 0);

  const [shipped, late, problem, cancelled] = await Promise.all([
    prisma.event.count({ where: { type: 'order_shipped', createdAt: { gte: start, lt: end } } }),
    prisma.event.count({ where: { type: 'order_late', createdAt: { gte: start, lt: end } } }),
    prisma.event.count({ where: { type: 'order_problem', createdAt: { gte: start, lt: end } } }),
    prisma.event.count({ where: { type: 'order_cancelled', createdAt: { gte: start, lt: end } } })
  ]);

  // Truck-leg shipment tracking (matches the RAPPORT_TRUCK spreadsheet):
  // "En transit" is always the current full list (it's a live operational
  // view, not a monthly historical one). "Arrivées" is filtered to the
  // selected month, since once arrived it becomes a historical record.
  const enTransit = await prisma.truckShipment.findMany({
    where: { status: 'in_transit' },
    orderBy: { dateReception: 'asc' }
  });
  const arrivees = await prisma.truckShipment.findMany({
    where: { status: 'arrived', dateReception: { gte: start, lt: end } },
    orderBy: { dateReception: 'asc' }
  });

  return { label, invoices, totalRevenue, counts: { shipped, late, problem, cancelled }, enTransit, arrivees };
}

router.get('/report', async (req, res) => {
  const data = await computeReportData(req.query.month);
  const { monthParam } = monthBounds(req.query.month);
  res.render('report', { ...data, monthParam });
});

router.get('/report/download', async (req, res) => {
  const data = await computeReportData(req.query.month);
  const pdf = await generateMonthlyReportPdf(data);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Rapport_${req.query.month || 'mois-courant'}.pdf"`);
  res.send(pdf);
});

// ---------------------------------------------------------------------------
// Truck shipment tracking (LTA / Colis / Poids / ETD-ETA / Vol Connexion)
// ---------------------------------------------------------------------------
router.get('/report/truck/new', (req, res) => {
  res.render('truck_new', { error: null });
});

router.post('/report/truck', async (req, res) => {
  const b = req.body;
  try {
    await prisma.truckShipment.create({
      data: {
        ltaNumber: b.ltaNumber,
        dateReception: b.dateReception ? new Date(b.dateReception) : null,
        colis: b.colis ? parseInt(b.colis, 10) : null,
        poids: b.poids ? parseFloat(b.poids) : null,
        destination: b.destination || null,
        etdTruck: b.etdTruck ? new Date(b.etdTruck) : null,
        etaTruckCdg: b.etaTruckCdg ? new Date(b.etaTruckCdg) : null,
        dateFlightConex: b.dateFlightConex ? new Date(b.dateFlightConex) : null,
        comments: b.comments || null,
        remarque: b.remarque || null,
        status: 'in_transit'
      }
    });
    res.redirect('/report');
  } catch (err) {
    console.error(err);
    res.render('truck_new', { error: "Impossible d'ajouter l'expédition. Vérifiez les champs et réessayez." });
  }
});

router.post('/report/truck/:id/arrivee', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await prisma.truckShipment.update({ where: { id }, data: { status: 'arrived' } });
  res.redirect('/report');
});

// ---------------------------------------------------------------------------
// Rapport Factures - simple monthly list of invoices + clients
// ---------------------------------------------------------------------------
async function fetchFacturesInvoices(monthParam) {
  const { start, end } = monthBounds(monthParam);
  return prisma.invoice.findMany({
    where: { createdAt: { gte: start, lt: end }, archived: false },
    include: { client: true },
    orderBy: { createdAt: 'asc' }
  });
}

router.get('/rapport-factures', async (req, res) => {
  const { label, monthParam } = monthBounds(req.query.month);
  const invoices = await fetchFacturesInvoices(req.query.month);
  const total = invoices.reduce((sum, i) => sum + i.amountTTC, 0);
  res.render('rapport_factures', { invoices, total, label, monthParam });
});

router.get('/rapport-factures/download', async (req, res) => {
  const { label, monthParam } = monthBounds(req.query.month);
  const invoices = await fetchFacturesInvoices(req.query.month);
  const buffer = await generateFacturesExcel(invoices, label);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Rapport_Factures_${monthParam}.xlsx"`);
  res.send(buffer);
});

// ---------------------------------------------------------------------------
// Rapport Cash - monthly cost/margin breakdown, cash payments only
// ---------------------------------------------------------------------------
async function fetchCashInvoices(monthParam) {
  const { start, end } = monthBounds(monthParam);
  return prisma.invoice.findMany({
    where: { createdAt: { gte: start, lt: end }, archived: false, isPlaceholder: false, paid: true, paidMode: 'Cash' },
    include: { client: true },
    orderBy: { createdAt: 'asc' }
  });
}

router.get('/rapport-cash', async (req, res) => {
  const { label, monthParam } = monthBounds(req.query.month);
  const invoices = await fetchCashInvoices(req.query.month);
  const totals = invoices.reduce((acc, i) => {
    acc.factComp += i.factComp || 0;
    acc.facturationUTS += i.facturationUTS || i.amountTTC || 0;
    acc.netteUTS += i.netteUTS || 0;
    return acc;
  }, { factComp: 0, facturationUTS: 0, netteUTS: 0 });
  res.render('rapport_cash', { invoices, totals, label, monthParam });
});

router.get('/rapport-cash/download', async (req, res) => {
  const { label, monthParam } = monthBounds(req.query.month);
  const invoices = await fetchCashInvoices(req.query.month);
  const buffer = await generateCashExcel(invoices, label);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Rapport_Cash_${monthParam}.xlsx"`);
  res.send(buffer);
});

// ---------------------------------------------------------------------------
// Rapport Recouvrement - everyone who hasn't paid yet, not split by month
// ---------------------------------------------------------------------------
async function fetchRecouvrementInvoices() {
  return prisma.invoice.findMany({
    where: { archived: false, paid: false },
    include: { client: true },
    orderBy: { createdAt: 'asc' }
  });
}

router.get('/rapport-recouvrement', async (req, res) => {
  const invoices = await fetchRecouvrementInvoices();
  const total = invoices.reduce((sum, i) => sum + (i.facturationUTS || i.amountTTC || 0), 0);
  res.render('rapport_recouvrement', { invoices, total });
});

router.get('/rapport-recouvrement/download', async (req, res) => {
  const invoices = await fetchRecouvrementInvoices();
  const buffer = await generateRecouvrementExcel(invoices);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Rapport_Recouvrement.xlsx"`);
  res.send(buffer);
});

module.exports = router;
