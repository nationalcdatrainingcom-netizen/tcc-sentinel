# TCC Sentinel 🛡️

A monitoring agent that watches Mary's entire app ecosystem — TCC, MSA, and personal — and alerts her only when something actually needs her attention. Silent when healthy, loud when critical.

Designed agent-shaped from day one so it can fold into the future **Chief of Staff** project: Sentinel becomes the "app health" agent, and future agents (Gmail, GCal, GitHub, Slack, Render) all report to the same central dispatcher.

---

## What it does

**Four layers of checks**, each deeper than the last:

| Layer | What it checks | When it runs |
|-------|----------------|--------------|
| **1 — Alive** | HTTP GET returns 200-399 | Every hour |
| **2 — Login** | Auth endpoint accepts sentinel credentials | Every hour |
| **3 — Smoke** | App's `/api/health` confirms DB, env vars, deps | Daily 6 AM ET |
| **4 — Data** | App-specific sanity (e.g., "did anyone clock in today?") | Daily 6 AM ET |

**Alert routing** (decided centrally in `alerts/dispatcher.js`):

- Critical app fails → **email + SMS immediately**
- Minor app fails → **dashboard only**, shows up in daily 6:30 AM digest
- Same failure stays silent for 4 hours after first alert (no spam)
- When a check returns to pass, the alert auto-resolves

---

## Stack

- Node.js 18+ / Express
- PostgreSQL (shared with Payroll Hub — tables prefixed `sentinel_`)
- node-cron for scheduling
- SendGrid for email
- Twilio for SMS
- JWT auth (same `HUB_JWT_SECRET` pattern as your other apps)

---

## Deployment steps

### 1. Push the repo to GitHub

Create a new repo called `tcc-sentinel` under your `nationalcdatrainingcom-netizen` org. Upload all files via the GitHub web editor.

### 2. Create a Render Web Service

- **Name:** `tcc-sentinel`
- **Environment:** Node
- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Plan:** Starter ($7/mo) or Free (note: free instances spin down after 15 min idle, which breaks hourly cron)

### 3. Set environment variables

Copy these into Render's Environment tab:

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | *Same connection string as Payroll Hub* |
| `HUB_JWT_SECRET` | `tcc-hub-jwt-2026` |
| `SENDGRID_API_KEY` | *Your existing SendGrid key* |
| `SENTINEL_FROM_EMAIL` | `billing@childrenscenterinc.com` |
| `SENTINEL_TO_EMAIL` | *Your email address* |
| `SENTINEL_USERNAME` | `sentinel` |
| `SENTINEL_PASSWORD` | *Pick a strong password — you'll reuse this in every app* |
| `SENTINEL_SHARED_SECRET` | *Random string, used for Layer 3 /api/health auth* |
| `SENTINEL_DASHBOARD_URL` | `https://tcc-sentinel.onrender.com` |
| `TWILIO_ACCOUNT_SID` | *From Twilio (see below)* |
| `TWILIO_AUTH_TOKEN` | *From Twilio* |
| `TWILIO_FROM_NUMBER` | *Your purchased Twilio number, format `+12695551234`* |
| `MARY_PHONE_NUMBER` | *Your cell, format `+12695551234`* |

### 4. Run the migration

Once deployed, open a Render Shell (Manual Deploy → Shell) and run:

```bash
node migrate.js
```

This creates the 4 tables and seeds all 18 apps with the starter criticality list.

### 5. Register with TCC Hub

Add `sentinel` to your hub's app list (owner-only access), URL `https://tcc-sentinel.onrender.com`. Same SSO pattern as the Payroll Hub and Leader Review.

### 6. Hit the dashboard

Navigate to `https://tcc-sentinel.onrender.com` (via TCC Hub for SSO). Layer 1 starts working immediately. The other layers need the setup below.

---

## Twilio setup (~10 minutes, ~$1/month)

### Sign up

1. Go to **twilio.com** → Sign up (use your business email)
2. Verify your phone number
3. On the first-time setup wizard, pick:
   - **Product:** SMS
   - **Use case:** Alerts & notifications
   - **Sending from:** A Twilio phone number
   - **Sending to:** US phone numbers
   - **Volume:** Under 1,000/month

### Get a phone number

1. Console → Phone Numbers → Manage → Buy a number
2. Search for a US number (Michigan area code if you want — `269` or `616`). Cost: **~$1.15/month**
3. Capabilities needed: **SMS only** (voice not required)
4. Buy it

### Grab your credentials

1. Console → Home. You'll see:
   - **Account SID** (starts with `AC...`)
   - **Auth Token** (click to reveal)
2. Console → Phone Numbers → Your number. Note the number in `+1...` format.

### Verify your destination number (trial only)

Twilio's free trial requires you to verify any number you're texting *to*. Once you upgrade (add $20 of credit — lasts years at this volume), this restriction lifts.

1. Console → Phone Numbers → Manage → Verified Caller IDs
2. Add your cell phone, verify via SMS code

### Paste into Render

Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, and `MARY_PHONE_NUMBER` env vars. Redeploy.

### Test it

In Render Shell:
```bash
node -e "require('./alerts/sms').sendSms('Sentinel test alert').then(console.log)"
```

You should get a text within 30 seconds.

**Expected monthly cost:** $1.15 phone + maybe 10-30 alerts × $0.008 = roughly **$1.50–$2/month**.

---

## Sentinel user rollout plan

Layer 2 login checks need a dedicated low-privilege user in each app. You can roll this out app-by-app at your own pace — Sentinel will show "Pending" on the dashboard for apps that aren't set up yet, and only activate Layer 2 once you flip the switch in the admin panel.

### The pattern

In each app's user/directors/admin table, add:

- **Username:** `sentinel`
- **Email:** `sentinel@childrenscenterinc.com` (doesn't have to receive mail)
- **Password:** *Same value as `SENTINEL_PASSWORD` env var*
- **Role:** Lowest read-only role available (viewer, readonly, staff)

### Suggested rollout order (easiest first)

| # | App | Notes |
|---|-----|-------|
| 1 | TCC Hub | Start here; once this works, you know the pattern |
| 2 | Payroll Hub | Add sentinel as a no-access staff user |
| 3 | Compliance Checker | |
| 4 | Staff Time Entry | Add to `directors` table, no center assignment |
| 5 | CACFP Suite | |
| 6 | Master Organizer | |
| 7 | Collections Hub | |
| 8 | Policy Assistant | |
| 9 | GSQ Self-Reflection | |
| 10 | Leader Performance Review | Viewer role, no director assignment |
| 11 | Curriculum Generator | |
| 12 | CDA Certificate Generator | Skip if magic-link-only auth |
| 13 | MSA Hub | |
| 14 | MSA QIF / SELCS / Training | |
| 15 | Mary Vision Center | |

### After adding the user in an app

1. Open Sentinel Admin → click **Edit** on that app
2. Flip **"Sentinel user created in this app?"** → **Yes**
3. Save
4. Click **"Run hourly checks now"** to verify Layer 2 passes
5. Move to the next app

### If an app has a non-standard login endpoint

Set the `login_url` field to whatever accepts `{ username, password }` JSON. The dispatcher accepts any of these as "login worked":
- Response has `token` or `jwt` or `accessToken` field
- Response has `success: true` or `ok: true`
- Response sets any `Set-Cookie` header

If your app returns something weirder, tell me and we'll adjust `checks/layer2.js`.

---

## Layer 3: `/api/health` endpoint template

Paste this into each app's `server.js` (or equivalent) to give Sentinel deep health data. Adjust the checks list based on what that app actually depends on.

```javascript
// Sentinel deep health check endpoint
// Returns structured JSON that Layer 3 can parse.
// Protected by shared secret to prevent public probing.

app.get('/api/health', async (req, res) => {
  const expectedSecret = process.env.SENTINEL_SHARED_SECRET;
  const provided = req.headers['x-sentinel-secret'];
  if (expectedSecret && provided !== expectedSecret) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const checks = {};
  let overall = true;

  // Check 1: Database connection
  try {
    await pool.query('SELECT 1');
    checks.database = { ok: true };
  } catch (err) {
    checks.database = { ok: false, error: err.message };
    overall = false;
  }

  // Check 2: Critical env vars are set
  const required = ['DATABASE_URL', 'HUB_JWT_SECRET'];  // ← customize per app
  const missing = required.filter(v => !process.env[v]);
  checks.env = missing.length === 0
    ? { ok: true }
    : { ok: false, missing };
  if (missing.length > 0) overall = false;

  // Check 3: Can we read a key table? (customize per app)
  try {
    const { rows } = await pool.query('SELECT COUNT(*) FROM users');  // ← customize
    checks.key_table = { ok: true, count: parseInt(rows[0].count, 10) };
  } catch (err) {
    checks.key_table = { ok: false, error: err.message };
    overall = false;
  }

  // Add more app-specific checks here as needed:
  // - SendGrid API key valid?
  // - Anthropic API reachable?
  // - S3 / persistent disk writable?
  // - Critical tables have recent data?

  res.status(overall ? 200 : 503).json({
    ok: overall,
    app: 'payroll_hub',   // ← change per app
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    checks
  });
});
```

### Per-app customization suggestions

| App | Extra checks worth adding |
|-----|---------------------------|
| **Payroll Hub** | Recent `payroll_report_archives` row exists; pdfkit loads |
| **CACFP Suite** | `attendance_records` has data for current month |
| **Compliance** | `compliance_submissions` table readable; OpenAI/Anthropic key valid |
| **Collections Hub** | `billing_rates` populated for all 3 centers |
| **Master Organizer** | IMAP last-check timestamp < 1 hour old |
| **Policy Assistant** | All 4 knowledge sources load (`policy-data.txt`, `Licensing-chunks.json`, etc.) |
| **Leader Review** | Apps Script URL reachable (test fetch) |
| **Staff Time Entry** | `directors` table not empty |
| **GSQ Reflection** | Anthropic API key reachable; NeDB file present |
| **MSA apps** | PostgreSQL quiz_results / observations tables readable |

### After adding `/api/health` to an app

1. Deploy the change
2. Test: `curl -H "X-Sentinel-Secret: YOUR_SECRET" https://that-app.onrender.com/api/health`
3. Should return JSON with `ok: true` and a `checks` object
4. Layer 3 will pick it up on the next daily run (or hit "Run daily deep checks now" in Admin)

---

## Layer 4: Data sanity modules (optional, add when needed)

Layer 4 is pluggable. Each sanity module lives at `checks/sanity/{name}.js` and exports a `run(app, pool)` function that queries the shared DB and returns `{ ok: boolean, summary: string, ...data }`.

An example is in `checks/sanity/staff_time_heartbeat.js`. It flags "no time entries in 48 hours."

To activate it for an app:
1. Create the module file
2. Git commit + push, let Render redeploy
3. In Admin, edit the app and set **Data sanity module** to the filename (without `.js`)
4. Save

Good candidates (add as real failure modes emerge):

- **Master Organizer**: No tour emails received in 24 hours during business hours? Weird.
- **CACFP Suite**: Today's meal counts not entered by 3 PM? Flag.
- **Collections Hub**: Any CDC family with zero billing for >7 days? Flag.
- **Payroll Hub**: Upcoming pay period has <50% of expected entries 2 days before payroll? Flag.
- **Compliance**: License expiring in <30 days? Flag.

---

## How alerts get deduped

This matters because Render has bad mornings — you don't want 40 texts when your region has an outage.

**Dedupe key** = `{app_key}:layer{N}`

**Dedupe window** = 4 hours (configurable via `ALERT_DEDUPE_MINUTES` in `alerts/dispatcher.js`)

**Auto-resolve**: When a check goes back to `pass`, the open alert is marked resolved, so if it fails *again later*, you get a fresh alert.

This means:
- First failure → alert fires
- Same failure for the next 4 hours → silent
- Fixed (1+ passing check) → alert closes
- Breaks again → fresh alert (not deduped)

---

## Monitoring Sentinel itself (the "who watches the watchmen" problem)

Sentinel runs on Render just like your other apps. If Render's whole US region goes down, Sentinel goes down with it — and can't tell you.

**Two mitigations:**

1. **External uptime ping.** Set up a free UptimeRobot monitor (uptimerobot.com, 50 monitors free) that pings `https://tcc-sentinel.onrender.com` every 5 minutes. If that fails, UptimeRobot emails you directly. This catches the case where Sentinel itself is dead.

2. **Run log.** The `/api/run-log` endpoint shows when Sentinel last ran. If the most recent `sentinel_run_log` entry is >2 hours old, something's wrong with cron. Worth a glance on the dashboard occasionally (or build a "stale run log" check in a future Layer 5).

---

## File map

```
tcc-sentinel/
├── server.js               Express app, cron jobs, admin API
├── run-checks.js           Runs one pass of checks across all enabled apps
├── migrate.js              Schema + seed data (idempotent)
├── schema.sql              4 tables
├── db.js                   PG connection pool
├── package.json
├── render.yaml
├── .gitignore
├── checks/
│   ├── layer1.js           HTTP ping
│   ├── layer2.js           Login test
│   ├── layer3.js           Smoke test via /api/health
│   ├── layer4.js           Data sanity framework
│   └── sanity/
│       └── staff_time_heartbeat.js   Example data sanity module
├── alerts/
│   ├── dispatcher.js       Central decision logic + daily digest
│   ├── email.js            SendGrid
│   └── sms.js              Twilio
└── public/
    ├── dashboard.html      Green/yellow/red status grid
    └── admin.html          Add/edit apps, trigger runs
```

---

## Fold-in plan: Chief of Staff

When you're ready to build Chief of Staff, Sentinel becomes **one agent of many**. The pattern to reuse:

1. `agents/sentinel.js` = the current `run-checks.js` logic, refactored as a class with `async monitor()` method
2. Add siblings: `agents/gmail.js`, `agents/gcal.js`, `agents/github.js`, `agents/render.js`, `agents/slack.js`
3. All of them call the same `alerts/dispatcher.js` with `{severity, summary, source, details}`
4. Dispatcher already has the dedupe + channel-routing logic — you just add more sources feeding into it
5. A top-level "conductor" thread orchestrates which agents run when, escalates based on signals, and handles the "should I wake Mary at 2 AM for this?" decisions

The database tables generalize cleanly:
- `sentinel_apps` → `cos_monitored_sources` (apps, inboxes, calendars, repos…)
- `sentinel_check_results` → `cos_observations`
- `sentinel_alerts_sent` → stays exactly as is

---

## Troubleshooting

**"Sentinel dashboard shows no apps"**
Run `node migrate.js` in Render Shell.

**"All apps show Layer 1 fail but they work fine in my browser"**
Check `DATABASE_URL` is set. Sentinel can't record results without the DB.

**"Layer 2 keeps saying 'skip'"**
Expected until you flip `sentinel_user_configured` → Yes in Admin for each app.

**"I'm getting duplicate alerts every hour"**
Check `ALERT_DEDUPE_MINUTES` in `alerts/dispatcher.js`. Default is 240 (4 hours). If you're seeing duplicates inside that window, the dedupe table might not have been created — re-run `node migrate.js`.

**"Twilio says 'unverified number'"**
You're on the trial tier. Either verify the destination number in Twilio console, or upgrade ($20 credit lasts years at this volume).

**"Cron jobs aren't firing"**
Render free-tier web services spin down after 15 min idle — cron inside the Node process dies with them. Solution: upgrade to Starter ($7/mo) OR convert the crons to Render native Cron Jobs that invoke `node run-checks.js hourly` and `node run-checks.js daily` on schedule.

---

## When something breaks and you want to investigate

1. **Dashboard** → see which apps are red
2. Click into the app (or hit `/api/apps/{app_key}/history`) for the last 200 checks
3. Check `sentinel_run_log` to confirm Sentinel itself is running on schedule
4. Check `sentinel_alerts_sent` to see what's been sent vs. deduped

Built with 🛡️ for Mary's ecosystem, April 2026.
