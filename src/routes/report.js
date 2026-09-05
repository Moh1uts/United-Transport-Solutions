// src/routes/report.js
const express = require('express');
const router = express.Router();
const prisma = require('../db');
const { requireLogin } = require('../middleware/auth');
const { generateMonthlyReportPdf } = require('../services/report');

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

module.exports = router;
