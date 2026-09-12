// src/routes/settings.js
//
// Danger-zone admin actions. Currently just the full data reset - wipes every
// client, invoice, event, truck shipment, and monthly archive, but leaves the
// admin login itself untouched. Protected by requiring the exact word
// "SUPPRIMER" to be typed in, since this is irreversible.

const express = require('express');
const router = express.Router();
const prisma = require('../db');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

router.get('/settings', (req, res) => {
  res.render('settings', { error: null });
});

router.post('/settings/reset-data', async (req, res) => {
  if ((req.body.confirm || '').trim() !== 'SUPPRIMER') {
    return res.render('settings', { error: 'Il faut taper exactement "SUPPRIMER" pour confirmer. Rien n\'a été supprimé.' });
  }

  // Deleting all Clients cascades to their Invoices and Events automatically
  // (onDelete: Cascade in the schema). TruckShipment and MonthlyArchive are
  // independent tables and need clearing separately.
  await prisma.client.deleteMany({});
  await prisma.truckShipment.deleteMany({});
  await prisma.monthlyArchive.deleteMany({});

  res.redirect('/potential?flash=Toutes les données ont été supprimées — vous repartez de zéro');
});

module.exports = router;
