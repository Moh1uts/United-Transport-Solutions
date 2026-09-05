# United Transport Solutions — Backend

A small internal tool for managing quotes and orders through three
categories — **Potential Clients**, **Active Clients**, **Refused Clients**
— with automated SMS + email notifications (in French, then English, then
Arabic) at every step, PDF invoice generation, and a monthly report.

---

## ⚠️ Before you start: what actually needs setting up

This backend needs **three outside services** to fully work. Nothing sends
until these are configured — the app will still run without them (it just
logs "skipped" instead of crashing), so you can deploy and click around
before wiring up messaging.

| Service | What it's for | Cost |
|---|---|---|
| A **PostgreSQL database** | stores clients, orders, invoices | Free tier on Render |
| **Twilio** (or similar) | sending the automated SMS | Pay-per-message (see cost note below) |
| **Google Workspace** (already set up) | sending the automated emails | Free — reuses `contact@unitedtransportsolutions.com` |

### SMS cost & deliverability — read this first
Every automated message is sent in **French, then English, then Arabic**,
per your spec. Two consequences worth knowing before you rely on this:

1. **Cost**: SMS containing Arabic script can't use the cheap 160-char GSM
   encoding — it's forced into ~70-char Unicode segments. A 3-language
   message will typically cost **3-5x a single normal SMS** in provider
   fees. This adds up if you have a lot of clients — check Twilio's
   Morocco pricing before relying on this at volume.
2. **Deliverability**: some countries filter which numbers can
   transactionally text local phones. **Test with a real Moroccan mobile
   number before trusting this for real clients.** If delivery is
   unreliable, a Morocco-specific SMS gateway/aggregator may work better
   than Twilio — the code in `src/services/sms.js` is a single small file,
   easy to swap out.

---

## Project structure

```
backend/
  prisma/schema.prisma      — database structure
  scripts/seed-admin.js     — creates your login
  src/
    server.js               — app entry point
    db.js                   — database connection
    middleware/auth.js       — login check
    routes/
      auth.js               — login/logout
      dashboard.js          — all 3 categories + every action button
      invoices.js           — invoice list & PDF download
      report.js             — monthly report
      publicApi.js          — the endpoint the WEBSITE calls
    services/
      messages.js           — all message text, FR/EN/AR
      email.js              — sends email (Google Workspace)
      sms.js                — sends SMS (Twilio)
      notify.js             — sends both at once for any action
      invoice.js            — generates the Facture PDF
      report.js             — generates the monthly report PDF
    views/                  — all the dashboard pages (EJS templates)
    public/style.css        — dashboard styling
```

---

## 1. Local setup (to test before deploying)

```bash
cd backend
npm install
cp .env.example .env
# edit .env with real values (see sections below for how to get each one)
```

For local testing without a real Postgres server, the fastest option is
Render's free Postgres (see step 3) — just point `DATABASE_URL` at it even
while testing locally, no separate local database needed.

Once `.env` is filled in:

```bash
npx prisma migrate dev --name init   # creates the database tables
npm run seed                          # creates your login (ADMIN_EMAIL/ADMIN_PASSWORD from .env)
npm run dev                           # starts the server on http://localhost:3000
```

Log in at `http://localhost:3000/login` with the email/password from `.env`.

---

## 2. Setting up Google Workspace email sending

You cannot use your normal Google password for automated sending. You need
an **App Password**:

1. Go to your Google Account → **Security**.
2. Turn on **2-Step Verification** if it isn't already on (required for App
   Passwords to appear as an option).
3. Search for **"App Passwords"** in the same Security settings.
4. Create one — name it "UTS Backend" — Google shows you a 16-character
   code (looks like `abcd efgh ijkl mnop`).
5. Put that code (no spaces) as `SMTP_APP_PASSWORD` in `.env` / Render.
6. `SMTP_USER` is just `contact@unitedtransportsolutions.com`.

---

## 3. Setting up Twilio (SMS)

1. Create an account at [twilio.com](https://www.twilio.com) — the trial
   gives free credit to test with.
2. Buy a phone number (Console → Phone Numbers → Buy a number). Make sure
   **SMS** capability is enabled, and check that international sending to
   Morocco is allowed (Twilio may require enabling specific
   geographic permissions for some countries under **Messaging → Settings →
   Geographic Permissions**).
3. From the Console dashboard copy:
   - **Account SID** → `TWILIO_ACCOUNT_SID`
   - **Auth Token** → `TWILIO_AUTH_TOKEN`
   - The phone number you bought (in `+1XXXXXXXXXX` format) → `TWILIO_FROM_NUMBER`
4. **Test with a real Moroccan number before trusting this for clients** —
   see the cost/deliverability note above.

---

## 4. Deploying — GitHub + Render

**Push this folder to GitHub:**
```bash
cd backend
git init
git add .
git commit -m "Initial backend"
# create a new empty repo on github.com, then:
git remote add origin https://github.com/YOUR-USERNAME/uts-backend.git
git push -u origin main
```

**On Render (render.com):**

1. **New → PostgreSQL** — free tier is enough to start. Once created, copy
   its **"Internal Database URL"**.
2. **New → Web Service** → connect your GitHub repo.
   - Build command: `npm install`
   - Start command: `npm start`
3. Under **Environment**, add every variable from `.env.example` with real
   values (including the `DATABASE_URL` from step 1).
4. Deploy. Render will run `npm install` (which also runs
   `prisma generate` automatically via the `postinstall` script).
5. Open a **Shell** tab on the Render service (or run once locally pointed
   at the same `DATABASE_URL`) and run:
   ```bash
   npx prisma migrate deploy
   npm run seed
   ```
   This creates the database tables and your login.
6. Visit your Render URL + `/login`.

You now have a real URL like `https://uts-backend.onrender.com`.

*Render's free web service tier sleeps after inactivity and takes ~30
seconds to wake up on the next request — fine for an internal tool used a
few times a day, but worth knowing. Paid tier removes this if it becomes
annoying.*

---

## 5. Connecting the website to this backend

Right now, the quote-request form on the marketing website only opens
WhatsApp/email on the visitor's own device — it doesn't reach this backend
at all. To make quotes land automatically in **Potential Clients**, the
form's JavaScript needs one more step: also send the data to this backend's
public endpoint.

In the website's `index.html`, inside the `submitRegistration()` function,
add this near the top (after the required-field validation, before the
`if(channel === 'whatsapp')` block):

```javascript
fetch('https://YOUR-RENDER-URL.onrender.com/api/public/quote', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': 'THE-SAME-VALUE-AS-PUBLIC_QUOTE_API_KEY'
  },
  body: JSON.stringify({
    name, phone, email, city, dest, date, nature, colis, poids, volume, ice, notes
  })
}).catch(() => { /* silently ignore - WhatsApp/email still work as a fallback */ });
```

Replace `YOUR-RENDER-URL` with your real Render URL, and the `x-api-key`
value with whatever you set `PUBLIC_QUOTE_API_KEY` to in the backend's
environment variables — **they must match exactly.**

This keeps the existing WhatsApp/email flow working exactly as before *and*
additionally logs the request into the backend. If the backend is ever
down, the client's WhatsApp/email still goes through — this call fails
silently in the background.

---

## 6. How the flow actually works, end to end

1. **Client submits quote** (website form, or you add manually via "+ Add
   Client") → lands in **Potential Clients** → automatic SMS + email:
   *"we received your quote, will be in touch shortly"* (FR/EN/AR).
2. You review it, then click one of:
   - **Ready to work with you** → sends a message asking them to call.
   - **Sorry, we can't** (reason required) → sends the reason + "call us
     if we made a mistake" + **moves them to Refused Clients**.
   - **Rewake** → friendly "still available" reminder, for non-responders.
   - **Move to Active Clients** → once they've confirmed by phone/WhatsApp
     that they accept (this is a manual step — there's no automatic
     detection of a reply).
3. In **Active Clients**, six buttons track the order lifecycle: order
   received, shipped (tracking number), arrived (auto-generates and emails
   the invoice PDF, saved permanently), late, problem, cancelled — each
   sends the client a message except the ones you choose to just log.
4. In **Refused Clients**, two buttons let you invite them back — either
   for the *same* order (circumstances changed) or a *different* service.
5. **Invoices** page lists every generated Facture PDF, downloadable
   anytime — this is your permanent "receipts" folder.
6. **Monthly Report** page shows orders delivered, revenue, shipped/late/
   problem/cancelled counts for any month, downloadable as a PDF.

---

## Known limitations, honestly

- **I could not run or test this backend live** — I don't have internet
  access in the environment I built it in, so I couldn't `npm install` or
  hit real Twilio/Google/Postgres services. Every file is syntax-checked
  and the core logic (message templates, invoice number-to-words) is
  tested against your real sample invoice — but the first real end-to-end
  run will be on your machine or Render's.
- **Only one login** is created by the seed script. If more than one
  person needs dashboard access, re-run `npm run seed` with a different
  `ADMIN_EMAIL` to add a second account (running it again won't delete the
  first).
- **"Move to Active"** and the two "invite back" buttons don't send an
  automatic message tied to the category change itself (only the buttons
  you clicked explicitly do) — this matches what was asked, but flagging
  it in case it should also notify.
