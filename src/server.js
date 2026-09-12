// src/server.js
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const invoiceRoutes = require('./routes/invoices');
const reportRoutes = require('./routes/report');
const publicApiRoutes = require('./routes/publicApi');
const monthlyArchiveRoutes = require('./routes/monthlyArchive');
const settingsRoutes = require('./routes/settings');
const prisma = require('./db');
const { ensureMonthlyArchiveGenerated } = require('./services/monthlyArchive');

const app = express();

// Render (like most hosts) terminates HTTPS at its own proxy and forwards
// plain HTTP internally. Without this, Express can't tell the original
// request was HTTPS, so the secure session cookie below never actually
// gets sent to the browser - login succeeds server-side but the browser
// looks logged out on the very next page.
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// CORS: only the public quote API needs to be reachable from the website's
// domain. Set ALLOWED_ORIGIN to your website's URL, e.g.
// https://unitedtransportsolutions.com (no trailing slash).
app.use(
  '/api/public',
  cors({
    origin: process.env.ALLOWED_ORIGIN || '*'
  })
);

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-me-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      secure: process.env.NODE_ENV === 'production'
    }
  })
);

// Public (no login) routes - must come before dashboard routes
app.use(publicApiRoutes);

// Everything below requires login (enforced inside each router via requireLogin)
app.use(authRoutes);

// Opportunistic check: is last month's invoice archive ready yet? If not,
// and last month has genuinely ended, generate it now. Cheap on every
// request except the very first one after a month rolls over - see
// services/monthlyArchive.js for why there's no true cron on Render's free
// tier. res.locals.unreadArchive drives the bell icon shown in every view.
app.use(async (req, res, next) => {
  try {
    await ensureMonthlyArchiveGenerated();
    const unread = await prisma.monthlyArchive.findFirst({
      where: { notified: false },
      orderBy: { createdAt: 'desc' }
    });
    res.locals.unreadArchive = unread || null;
  } catch (err) {
    console.error('[monthlyArchive check] error:', err);
    res.locals.unreadArchive = null;
  }
  next();
});

app.use(invoiceRoutes);
app.use(reportRoutes);
app.use(monthlyArchiveRoutes);
app.use(settingsRoutes);
app.use(dashboardRoutes);

app.use((req, res) => res.status(404).send('Not found'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`UTS backend listening on port ${PORT}`);
});
