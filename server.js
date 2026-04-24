// TCC Sentinel server
// - Serves dashboard (/) and admin (/admin) pages
// - REST API for check history, app management
// - Cron jobs for hourly and daily check runs
// - TCC Hub SSO receiver for owner-only auth

require('dotenv').config();
const express = require('express');
const path = require('path');
const cron = require('node-cron');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const { runChecks } = require('./run-checks');
const { sendDailyDigest } = require('./alerts/dispatcher');

const app = express();
app.use(express.json({ limit: '1mb' }));

// ---------- Auth middleware (Hub SSO via JWT) ----------
const HUB_JWT_SECRET = process.env.HUB_JWT_SECRET || 'tcc-hub-jwt-2026';

function requireAuth(req, res, next) {
  const token = req.cookies?.sentinel_jwt
    || req.query.token
    || (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const payload = jwt.verify(token, HUB_JWT_SECRET);
    if (payload.role !== 'owner' && payload.role !== 'super_admin') {
      return res.status(403).json({ error: 'Owner access required' });
    }
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Fetch-patch injection so the hub can pass identity via URL parameter
// (same pattern as compliance app)
app.get('/sso', (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/');
  try {
    jwt.verify(token, HUB_JWT_SECRET);
    res.cookie('sentinel_jwt', token, { httpOnly: false, sameSite: 'lax' });
    res.redirect('/');
  } catch {
    res.redirect('/');
  }
});

// ---------- Explicit routes BEFORE express.static ----------
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ---------- API ----------

// Summary for dashboard - latest result per (app, layer)
app.get('/api/status', async (req, res) => {
  try {
    const { rows: apps } = await pool.query(
      `SELECT * FROM sentinel_apps WHERE enabled = TRUE
       ORDER BY CASE criticality WHEN 'critical' THEN 0 ELSE 1 END, display_name`
    );
    const { rows: latest } = await pool.query(`
      SELECT DISTINCT ON (app_key, layer)
        app_key, layer, status, summary, response_time_ms, status_code, checked_at
      FROM sentinel_check_results
      ORDER BY app_key, layer, checked_at DESC
    `);
    const byApp = {};
    for (const row of latest) {
      byApp[row.app_key] = byApp[row.app_key] || {};
      byApp[row.app_key][`layer${row.layer}`] = row;
    }
    const result = apps.map(a => ({
      ...a,
      latest: byApp[a.app_key] || {}
    }));
    res.json({ apps: result, generated_at: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// History for a specific app
app.get('/api/apps/:app_key/history', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM sentinel_check_results
       WHERE app_key = $1 ORDER BY checked_at DESC LIMIT 200`,
      [req.params.app_key]
    );
    res.json({ results: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List all apps (includes disabled) - admin
app.get('/api/admin/apps', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM sentinel_apps ORDER BY display_name'
  );
  res.json({ apps: rows });
});

// Create app
app.post('/api/admin/apps', requireAuth, async (req, res) => {
  const {
    app_key, display_name, base_url, login_url,
    smoke_test_endpoint, data_sanity_module,
    criticality, notes
  } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO sentinel_apps
        (app_key, display_name, base_url, login_url, smoke_test_endpoint,
         data_sanity_module, criticality, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [app_key, display_name, base_url, login_url || null,
       smoke_test_endpoint || null, data_sanity_module || null,
       criticality || 'minor', notes || null]
    );
    res.json({ app: rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update app
app.patch('/api/admin/apps/:id', requireAuth, async (req, res) => {
  const allowed = [
    'display_name', 'base_url', 'login_url', 'smoke_test_endpoint',
    'data_sanity_module', 'criticality', 'enabled', 'notes',
    'sentinel_user_configured'
  ];
  const updates = [];
  const values = [];
  let i = 1;
  for (const field of allowed) {
    if (field in req.body) {
      updates.push(`${field} = $${i++}`);
      values.push(req.body[field]);
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: 'No valid fields' });
  updates.push(`updated_at = NOW()`);
  values.push(req.params.id);
  try {
    const { rows } = await pool.query(
      `UPDATE sentinel_apps SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    res.json({ app: rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete app
app.delete('/api/admin/apps/:id', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM sentinel_apps WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// Manual trigger for a full check run (handy from admin page)
app.post('/api/admin/run-now', requireAuth, async (req, res) => {
  const runType = req.body.runType || 'hourly';
  // Fire and forget - return immediately, run in background
  runChecks(runType).catch(err => console.error('Manual run failed:', err));
  res.json({ started: true, runType });
});

// Recent alerts (dashboard)
app.get('/api/alerts/recent', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT * FROM sentinel_alerts_sent
    WHERE sent_at > NOW() - INTERVAL '7 days'
    ORDER BY sent_at DESC LIMIT 100
  `);
  res.json({ alerts: rows });
});

// Run log (did sentinel itself run recently?)
app.get('/api/run-log', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM sentinel_run_log ORDER BY started_at DESC LIMIT 50'
  );
  res.json({ runs: rows });
});

// ---------- Static last (after explicit routes) ----------
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Cron ----------
// Hourly: Layers 1+2 at :07 every hour
cron.schedule('7 * * * *', () => {
  console.log('[cron] Hourly check starting');
  runChecks('hourly').catch(err => console.error('Hourly run failed:', err));
});

// Daily deep: Layers 1+2+3+4 at 6:00 AM Eastern
// Render uses UTC - 6:00 AM ET = 10:00 AM UTC (EST) or 11:00 AM UTC (EDT)
// Using 10:15 UTC for EST / 11:15 in summer - Mary can adjust if DST is an issue
cron.schedule('15 10 * * *', () => {
  console.log('[cron] Daily deep check starting');
  runChecks('daily').catch(err => console.error('Daily run failed:', err));
});

// Daily digest at 6:30 AM ET
cron.schedule('30 10 * * *', () => {
  console.log('[cron] Daily digest');
  sendDailyDigest().catch(err => console.error('Digest failed:', err));
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`TCC Sentinel listening on ${PORT}`);
});
