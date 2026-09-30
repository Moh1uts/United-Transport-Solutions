// src/routes/publicApi.js
//
// The ONLY route in this app that is not behind login - it's what the
// public marketing website's "registration form" submits to, so that a
// quote request lands directly in the "Potential Clients" category
// without your dad needing to re-type anything from a WhatsApp message.
//
// Protected by:
//   1. A shared secret key (PUBLIC_QUOTE_API_KEY) the website sends in the
//      `x-api-key` header - stops random bots hitting the endpoint. This is
//      visible in the website's source code (any client-side secret is),
//      so it's a spam speed-bump, not real security.
//   2. A tiny in-memory rate limiter per IP address.

const express = require('express');
const router = express.Router();
const prisma = require('../db');
const { notifyClient, notifyOwnerNewQuote } = require('../services/notify');

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 5;
const hits = new Map(); // ip -> [timestamps]

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const timestamps = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  timestamps.push(now);
  hits.set(ip, timestamps);
  if (timestamps.length > MAX_REQUESTS_PER_WINDOW) {
    return res.status(429).json({ error: 'Too many requests, please try again shortly.' });
  }
  next();
}

function checkApiKey(req, res, next) {
  if (!process.env.PUBLIC_QUOTE_API_KEY) return next(); // not configured -> skip check (dev mode)
  if (req.headers['x-api-key'] !== process.env.PUBLIC_QUOTE_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// A single box's dimensions coming from the website, cleaned up to
// {longueur, largeur, hauteur, count} numbers in cm, or null if incomplete/
// invalid. `count` is the "smart dimensions" x-quantity field next to each
// package row (identical boxes entered once, e.g. count=3, instead of
// pasted three times) - defaults to 1, clamped to a sane range so a typo
// or abuse attempt can't create an absurd number of "boxes" server-side.
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

router.post('/api/public/quote', rateLimit, checkApiKey, async (req, res) => {
  const b = req.body || {};

  // destinationCity/destinationCountry are the split fields the website's
  // form now collects (so the dashboard can suggest nearby arrival
  // airports - see services/airports.js); `destination` is still accepted/
  // required too, as the combined "City, Country" string every other part
  // of the app displays.
  if (!b.name || !b.phone || !b.email || !b.city || !b.destination || !b.nature || !b.destinationCity || !b.destinationCountry) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // The website's "+" button lets a visitor list several boxes at once -
  // b.dimensions arrives as an array of {longueur, largeur, hauteur} (cm).
  // We keep the legacy single longueur/largeur/hauteur columns in sync with
  // the first box too, purely so older reports/exports that only know about
  // those columns still show something sensible; `dimensions` (JSON) is the
  // source of truth whenever there's more than one box.
  const dimensions = Array.isArray(b.dimensions)
    ? b.dimensions.map(sanitizeBox).filter(Boolean)
    : [];
  const firstBox = dimensions[0] || sanitizeBox({ longueur: b.longueur, largeur: b.largeur, hauteur: b.hauteur });

  try {
    const client = await prisma.client.create({
      data: {
        name: String(b.name).slice(0, 200),
        phone: String(b.phone).slice(0, 50),
        email: String(b.email).slice(0, 200),
        city: String(b.city).slice(0, 100),
        destination: String(b.destination).slice(0, 200),
        destinationCity: String(b.destinationCity).slice(0, 100),
        destinationCountry: String(b.destinationCountry).slice(0, 100),
        nature: String(b.nature).slice(0, 300),
        packages: b.packages ? parseInt(b.packages, 10) || null : null,
        weightKg: b.weightKg ? parseFloat(b.weightKg) || null : null,
        longueur: firstBox ? firstBox.longueur : null,
        largeur: firstBox ? firstBox.largeur : null,
        hauteur: firstBox ? firstBox.hauteur : null,
        dimensions: dimensions.length > 0 ? dimensions : undefined,
        volume: b.volume ? String(b.volume).slice(0, 100) : null,
        gerbable: b.gerbable ? String(b.gerbable).slice(0, 10) : null,
        ice: b.ice ? String(b.ice).slice(0, 50) : null,
        preferredDate: b.preferredDate ? String(b.preferredDate).slice(0, 50) : null,
        notes: b.notes ? String(b.notes).slice(0, 1000) : null,
        source: 'website',
        status: 'potential'
      }
    });

    const result = await notifyClient(client, 'quote_received', {});
    await prisma.event.create({
      data: { clientId: client.id, type: 'quote_received', messageSent: result.bothOk }
    });
    // Fire-and-forget: alert your dad that a new quote request came in from
    // the website. Doesn't block or affect the response to the visitor -
    // if it fails (or isn't configured yet), the quote is still saved fine.
    notifyOwnerNewQuote(client).catch((err) => console.error('[public/quote] owner alert failed:', err));

    res.json({ success: true });
  } catch (err) {
    console.error('[public/quote] error:', err);
    res.status(500).json({ error: 'Something went wrong. Please contact us directly.' });
  }
});

// ---------------------------------------------------------------------------
// Client-facing Accepter / Refuser links, clicked from the "Nous sommes
// prêts" (ready_to_work) email - no login, reachable by anyone with the
// link, so the link itself (a random 48-char token, not the client's
// database id) is what protects it. A fresh token is issued every time a
// tarif is (re)sent (see dashboard.js /clients/:id/ready-to-work), so an
// old email's buttons stop working once a new quote goes out.
//
// This only records the answer on the client's record (visible in Demandes
// en Attente) - it does NOT move them to Demandes Actives by itself. Your
// dad still clicks "Déplacer vers Demandes Actives" himself once he's seen
// the acceptance, same as he would after a phone call.
router.get('/respond/:token', async (req, res) => {
  const { token } = req.params;
  const action = req.query.action === 'refuse' ? 'refused' : (req.query.action === 'accept' ? 'accepted' : null);

  if (!token || !action) return res.status(400).send('Lien invalide / Invalid link');

  const client = await prisma.client.findUnique({ where: { responseToken: token } });
  if (!client) {
    return res.status(404).render('public_respond', { ok: false, action: null });
  }

  // Only meaningful while still in Demandes en Attente - if it's already
  // moved on (active/refused/finished), the link is stale; still show a
  // friendly page instead of an error, just without changing anything.
  if (client.status === 'waiting') {
    await prisma.client.update({
      where: { id: client.id },
      data: { clientResponse: action, clientResponseAt: new Date() }
    });
    await prisma.event.create({
      data: { clientId: client.id, type: action === 'accepted' ? 'client_accepted' : 'client_refused' }
    });
  }

  res.render('public_respond', { ok: true, action });
});

module.exports = router;
