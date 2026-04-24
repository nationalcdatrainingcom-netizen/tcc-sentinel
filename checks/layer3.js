// Layer 3: Are the critical paths working?
// Hits an app-specific /api/health endpoint that each app will expose.
// The endpoint should: check DB connection, verify critical env vars,
// confirm key dependencies, and return JSON { ok: true, checks: {...} }.
//
// Skips gracefully if smoke_test_endpoint is null.

const fetch = require('node-fetch');

const TIMEOUT_MS = 20000;

async function layer3Check(app) {
  const endpoint = app.smoke_test_endpoint || (app.base_url + '/api/health');

  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'TCC-Sentinel/1.0',
        'X-Sentinel-Secret': process.env.SENTINEL_SHARED_SECRET || ''
      }
    });
    const elapsed = Date.now() - started;
    clearTimeout(timeout);

    if (res.status === 404) {
      return {
        layer: 3,
        status: 'skip',
        summary: 'No /api/health endpoint yet',
        details: { reason: 'endpoint_not_implemented' }
      };
    }

    let body = {};
    try { body = await res.json(); } catch (_) { /* */ }

    if (res.status >= 200 && res.status < 300 && body.ok === true) {
      return {
        layer: 3,
        status: 'pass',
        response_time_ms: elapsed,
        status_code: res.status,
        summary: `Smoke test passed (${elapsed}ms)`,
        details: body
      };
    }

    const failedChecks = body.checks
      ? Object.entries(body.checks).filter(([_, v]) => v && v.ok === false).map(([k]) => k)
      : [];

    return {
      layer: 3,
      status: 'fail',
      response_time_ms: elapsed,
      status_code: res.status,
      summary: failedChecks.length
        ? `Smoke fail: ${failedChecks.join(', ')}`
        : `Smoke fail (HTTP ${res.status})`,
      details: body
    };
  } catch (err) {
    clearTimeout(timeout);
    return {
      layer: 3,
      status: 'fail',
      response_time_ms: Date.now() - started,
      summary: `Smoke error: ${err.message}`,
      details: { error: err.message }
    };
  }
}

module.exports = { layer3Check };
