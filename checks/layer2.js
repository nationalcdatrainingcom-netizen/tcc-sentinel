// Layer 2: Can the app authenticate?
// Sends a login request with sentinel credentials. Considers pass if we get
// back a token/session cookie OR a 200 JSON response with success indicators.
// Skips gracefully if app is not configured with a sentinel user yet.

const fetch = require('node-fetch');

const TIMEOUT_MS = 15000;

async function layer2Check(app) {
  if (!app.login_url) {
    return {
      layer: 2,
      status: 'skip',
      summary: 'No login_url configured',
      details: { reason: 'login_url_missing' }
    };
  }
  if (!app.sentinel_user_configured) {
    return {
      layer: 2,
      status: 'skip',
      summary: 'Sentinel user not yet created in this app',
      details: { reason: 'sentinel_user_not_configured' }
    };
  }

  const username = process.env.SENTINEL_USERNAME || 'sentinel';
  const password = process.env.SENTINEL_PASSWORD;
  if (!password) {
    return {
      layer: 2,
      status: 'error',
      summary: 'SENTINEL_PASSWORD env var not set',
      details: { reason: 'missing_env' }
    };
  }

  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(app.login_url, {
      method: app.login_method || 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'TCC-Sentinel/1.0'
      },
      body: JSON.stringify({ username, password })
    });
    const elapsed = Date.now() - started;
    clearTimeout(timeout);

    let body = {};
    try { body = await res.json(); } catch (_) { /* non-json ok */ }

    const hasToken = !!(body.token || body.jwt || body.accessToken);
    const hasSuccess = body.success === true || body.ok === true;
    const hasSetCookie = !!res.headers.get('set-cookie');

    if (res.status >= 200 && res.status < 300 && (hasToken || hasSuccess || hasSetCookie)) {
      return {
        layer: 2,
        status: 'pass',
        response_time_ms: elapsed,
        status_code: res.status,
        summary: `Login works (${elapsed}ms)`,
        details: { has_token: hasToken, has_cookie: hasSetCookie }
      };
    }
    return {
      layer: 2,
      status: 'fail',
      response_time_ms: elapsed,
      status_code: res.status,
      summary: `Login rejected (HTTP ${res.status})`,
      details: { status_code: res.status, body_error: body.error || body.message }
    };
  } catch (err) {
    clearTimeout(timeout);
    const isTimeout = err.name === 'AbortError';
    return {
      layer: 2,
      status: 'fail',
      response_time_ms: Date.now() - started,
      summary: isTimeout ? `Login timeout` : `Login error: ${err.message}`,
      details: { error: err.message, timeout: isTimeout }
    };
  }
}

module.exports = { layer2Check };
