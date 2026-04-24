// Alert Dispatcher
// Central decision-maker: given a check result, should we notify Mary, and how?
//
// Rules:
//  - Critical app + Layer 1 or 2 fail        -> email + SMS immediately
//  - Critical app + Layer 3 or 4 fail        -> email + SMS immediately
//  - Minor app, any failure                  -> dashboard only (+ daily digest)
//  - Any 'error' status (sentinel bug)       -> email, never SMS
//  - 'skip' or 'pass'                        -> clear any active alert, no notification
//
// Dedupe: if the same (app_key, layer) is already in alert state and hasn't
// been resolved, don't re-send within ALERT_DEDUPE_MINUTES.
//
// This function is the ONLY place that decides "does this warrant waking Mary up."
// When Chief of Staff lands, other agents (gmail, gcal, github) will call this
// same dispatcher with their own {source, severity, summary, details}.

const pool = require('../db');
const { sendEmail } = require('./email');
const { sendSms } = require('./sms');

const ALERT_DEDUPE_MINUTES = 240; // 4 hours

function alertKey(appKey, layer, summary) {
  // Fingerprint is app+layer; summary is for readability only. Keeps dedupe
  // stable even if the exact error message varies slightly.
  return `${appKey}:layer${layer}`;
}

async function dispatch(app, result) {
  const key = alertKey(app.app_key, result.layer, result.summary);

  // Happy path - clear any active alert for this check
  if (result.status === 'pass' || result.status === 'skip') {
    await pool.query(
      `UPDATE sentinel_alerts_sent
         SET resolved_at = NOW()
       WHERE alert_key = $1 AND resolved_at IS NULL`,
      [key]
    );
    return { action: 'none', reason: `check ${result.status}` };
  }

  // Decide severity
  let severity;
  if (result.status === 'error') {
    severity = 'minor'; // sentinel's own error, email only
  } else if (app.criticality === 'critical') {
    severity = 'critical';
  } else {
    severity = 'minor';
  }

  // Dedupe
  const { rows: existing } = await pool.query(
    `SELECT id, sent_at FROM sentinel_alerts_sent
      WHERE alert_key = $1 AND resolved_at IS NULL
        AND sent_at > NOW() - INTERVAL '${ALERT_DEDUPE_MINUTES} minutes'
      ORDER BY sent_at DESC LIMIT 1`,
    [key]
  );
  if (existing.length > 0) {
    return { action: 'deduped', since: existing[0].sent_at };
  }

  const channels = [];
  const subject = `[${severity.toUpperCase()}] ${app.display_name} - ${result.summary}`;
  const body = buildAlertBody(app, result);

  // Always record dashboard alert
  channels.push('dashboard');

  // Critical -> email + SMS
  // Minor -> email only if 'error' type (sentinel issue); otherwise dashboard-only
  if (severity === 'critical') {
    try {
      await sendEmail(subject, body);
      channels.push('email');
    } catch (err) {
      console.error(`Email send failed for ${app.app_key}:`, err.message);
    }
    try {
      await sendSms(`${app.display_name}: ${result.summary}`);
      channels.push('sms');
    } catch (err) {
      console.error(`SMS send failed for ${app.app_key}:`, err.message);
    }
  } else if (result.status === 'error') {
    // Sentinel bug - email you, don't spam SMS
    try {
      await sendEmail(`[SENTINEL ERROR] ${subject}`, body);
      channels.push('email');
    } catch (err) {
      console.error(`Email send failed:`, err.message);
    }
  }
  // Minor fail -> dashboard only, will appear in daily digest

  // Log each channel
  for (const ch of channels) {
    await pool.query(
      `INSERT INTO sentinel_alerts_sent (app_key, alert_key, channel, severity, summary)
       VALUES ($1, $2, $3, $4, $5)`,
      [app.app_key, key, ch, severity, result.summary]
    );
  }

  return { action: 'sent', channels, severity };
}

function buildAlertBody(app, result) {
  return [
    `App:        ${app.display_name} (${app.app_key})`,
    `URL:        ${app.base_url}`,
    `Layer:      ${result.layer}`,
    `Status:     ${result.status.toUpperCase()}`,
    `Summary:    ${result.summary}`,
    result.status_code ? `HTTP Code:  ${result.status_code}` : null,
    result.response_time_ms ? `Time:       ${result.response_time_ms}ms` : null,
    '',
    `Details:`,
    JSON.stringify(result.details, null, 2),
    '',
    `Dashboard: ${process.env.SENTINEL_DASHBOARD_URL || 'https://tcc-sentinel.onrender.com'}`
  ].filter(Boolean).join('\n');
}

// Build and send the daily digest of minor issues from the past 24 hours.
async function sendDailyDigest() {
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (app_key, layer)
      cr.app_key,
      a.display_name,
      cr.layer,
      cr.status,
      cr.summary,
      cr.checked_at
    FROM sentinel_check_results cr
    JOIN sentinel_apps a ON a.app_key = cr.app_key
    WHERE cr.checked_at > NOW() - INTERVAL '24 hours'
      AND cr.status IN ('fail', 'error')
    ORDER BY cr.app_key, cr.layer, cr.checked_at DESC
  `);

  if (rows.length === 0) {
    // Good news digest - optional; comment out if you prefer silence when all clear
    await sendEmail('[Sentinel] Daily digest - all systems green',
      'All monitored apps passed all checks in the past 24 hours.');
    return { sent: true, issues: 0 };
  }

  const lines = rows.map(r =>
    `• ${r.display_name} - Layer ${r.layer}: ${r.summary}`
  );
  const body = [
    'Issues detected in the past 24 hours:',
    '',
    ...lines,
    '',
    `Full dashboard: ${process.env.SENTINEL_DASHBOARD_URL || 'https://tcc-sentinel.onrender.com'}`
  ].join('\n');

  await sendEmail(`[Sentinel] Daily digest - ${rows.length} issue(s)`, body);
  return { sent: true, issues: rows.length };
}

module.exports = { dispatch, sendDailyDigest };
