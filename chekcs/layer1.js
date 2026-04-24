// Layer 1: Is the app alive?
// Simple HTTP GET to base_url. Accepts 200-399 as pass.

const fetch = require('node-fetch');

const TIMEOUT_MS = 15000;

async function layer1Check(app) {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(app.base_url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'TCC-Sentinel/1.0 (health check)' }
    });
    const elapsed = Date.now() - started;
    clearTimeout(timeout);

    if (res.status >= 200 && res.status < 400) {
      return {
        layer: 1,
        status: 'pass',
        response_time_ms: elapsed,
        status_code: res.status,
        summary: `Alive (${res.status} in ${elapsed}ms)`,
        details: { ok: true, status_code: res.status }
      };
    } else {
      return {
        layer: 1,
        status: 'fail',
        response_time_ms: elapsed,
        status_code: res.status,
        summary: `HTTP ${res.status}`,
        details: { ok: false, status_code: res.status }
      };
    }
  } catch (err) {
    clearTimeout(timeout);
    const elapsed = Date.now() - started;
    const isTimeout = err.name === 'AbortError';
    return {
      layer: 1,
      status: 'fail',
      response_time_ms: elapsed,
      status_code: null,
      summary: isTimeout ? `Timeout after ${TIMEOUT_MS}ms` : `Network error: ${err.message}`,
      details: { ok: false, error: err.message, timeout: isTimeout }
    };
  }
}

module.exports = { layer1Check };
