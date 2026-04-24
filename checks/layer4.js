// Layer 4: Is the data flowing?
// Pluggable framework - each app that wants data sanity checks registers
// a module in checks/sanity/{module_name}.js that exports a `run(app, pool)` function.
//
// Examples of what a sanity module might check:
//   - payroll_hub: "someone clocked in today" (empty attendance table = red flag)
//   - cacfp_suite: "today's meal counts were entered"
//   - master_organizer: "tour emails are still being received"
//   - collections_hub: "no unbilled CDC children > 7 days"
//
// Start with zero sanity modules; add them per-app as real failure modes emerge.

const path = require('path');
const fs = require('fs');

async function layer4Check(app, pool) {
  if (!app.data_sanity_module) {
    return {
      layer: 4,
      status: 'skip',
      summary: 'No sanity module configured',
      details: { reason: 'module_not_configured' }
    };
  }

  const modulePath = path.join(__dirname, 'sanity', app.data_sanity_module + '.js');
  if (!fs.existsSync(modulePath)) {
    return {
      layer: 4,
      status: 'error',
      summary: `Sanity module file not found: ${app.data_sanity_module}`,
      details: { module: app.data_sanity_module }
    };
  }

  try {
    const mod = require(modulePath);
    if (typeof mod.run !== 'function') {
      return {
        layer: 4,
        status: 'error',
        summary: `Module missing run() function`,
        details: { module: app.data_sanity_module }
      };
    }
    const started = Date.now();
    const result = await mod.run(app, pool);
    const elapsed = Date.now() - started;
    return {
      layer: 4,
      status: result.ok ? 'pass' : 'fail',
      response_time_ms: elapsed,
      summary: result.summary || (result.ok ? 'Data looks sane' : 'Data sanity failed'),
      details: result
    };
  } catch (err) {
    return {
      layer: 4,
      status: 'error',
      summary: `Sanity module crashed: ${err.message}`,
      details: { error: err.message, stack: err.stack }
    };
  }
}

module.exports = { layer4Check };
