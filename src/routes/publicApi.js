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
const { notifyClient } = require('../services/notify');

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

router.post('/api/public/quote', rateLimit, checkApiKey, async (req, res) => {
  const b = req.body || {};

  if (!b.name || !b.phone || !b.email || !b.city || !b.destination || !b.nature) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const client = await prisma.client.create({
      data: {
        name: String(b.name).slice(0, 200),
        phone: String(b.phone).slice(0, 50),
        email: String(b.email).slice(0, 200),
        city: String(b.city).slice(0, 100),
        destination: String(b.destination).slice(0, 200),
        nature: String(b.nature).slice(0, 300),
        packages: b.packages ? parseInt(b.packages, 10) || null : null,
        weightKg: b.weightKg ? parseFloat(b.weightKg) || null : null,
        volume: b.volume ? String(b.volume).slice(0, 100) : null,
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

    res.json({ success: true });
  } catch (err) {
    console.error('[public/quote] error:', err);
    res.status(500).json({ error: 'Something went wrong. Please contact us directly.' });
  }
});

module.exports = router;
