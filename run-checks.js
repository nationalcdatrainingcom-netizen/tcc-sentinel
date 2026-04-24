// Runs one full pass of checks across all enabled apps.
// runType: 'hourly' (Layers 1+2 only) or 'daily' (Layers 1+2+3+4)
// Invoked by cron jobs in server.js OR directly as a Render Cron Job.

require('dotenv').config();
const pool = require('./db');
const { layer1Check } = require('./checks/layer1');
const { layer2Check } = require('./checks/layer2');
const { layer3Check } = require('./checks/layer3');
const { layer4Check } = require('./checks/layer4');
const { dispatch } = require('./alerts/dispatcher');

async function runChecks(runType = 'hourly') {
  const started = Date.now();
  const runLog = await pool.query(
    `INSERT INTO sentinel_run_log (run_type) VALUES ($1) RETURNING id`,
    [runType]
  );
  const runId = runLog.rows[0].id;

  const { rows: apps } = await pool.query(
    `SELECT * FROM sentinel_apps WHERE enabled = TRUE ORDER BY
       CASE criticality WHEN 'critical' THEN 0 ELSE 1 END, display_name`
  );

  const layers = runType === 'daily' ? [1, 2, 3, 4] : [1, 2];
  let failures = 0;

  for (const app of apps) {
    console.log(`\n=== ${app.display_name} (${app.app_key}) ===`);
    for (const layer of layers) {
      let result;
      try {
        if (layer === 1) result = await layer1Check(app);
        else if (layer === 2) result = await layer2Check(app);
        else if (layer === 3) result = await layer3Check(app);
        else if (layer === 4) result = await layer4Check(app, pool);
      } catch (err) {
        result = {
          layer,
          status: 'error',
          summary: `Sentinel bug: ${err.message}`,
          details: { error: err.message, stack: err.stack }
        };
      }

      console.log(`  L${layer} ${result.status.padEnd(5)} ${result.summary}`);

      await pool.query(
        `INSERT INTO sentinel_check_results
           (app_key, layer, status, response_time_ms, status_code, summary, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          app.app_key,
          result.layer,
          result.status,
          result.response_time_ms || null,
          result.status_code || null,
          result.summary,
          JSON.stringify(result.details || {})
        ]
      );

      if (result.status === 'fail' || result.status === 'error') {
        failures++;
      }

      const dispatchResult = await dispatch(app, result);
      if (dispatchResult.action === 'sent') {
        console.log(`     -> alert sent via ${dispatchResult.channels.join(', ')}`);
      }

      // Layer 1 fail -> skip deeper layers for this app (save time)
      if (layer === 1 && result.status !== 'pass') {
        console.log(`     (skipping deeper layers - app appears down)`);
        break;
      }
    }
  }

  const duration = Date.now() - started;
  await pool.query(
    `UPDATE sentinel_run_log SET apps_checked = $1, failures = $2, duration_ms = $3, finished_at = NOW()
     WHERE id = $4`,
    [apps.length, failures, duration, runId]
  );

  console.log(`\nDone. ${apps.length} apps checked, ${failures} failures, ${duration}ms`);
  return { appsChecked: apps.length, failures, duration };
}

// If called directly, run once and exit
if (require.main === module) {
  const runType = process.argv[2] || 'hourly';
  runChecks(runType)
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Run failed:', err);
      process.exit(1);
    });
}

module.exports = { runChecks };
