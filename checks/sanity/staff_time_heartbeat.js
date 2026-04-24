// Example Layer 4 sanity module for TCC Staff Time Entry.
//
// Checks: has anyone entered time in the last 48 hours? If zero entries,
// that's a red flag - either directors stopped using the app or it's broken
// in a way that Layers 1-3 didn't catch.
//
// To activate: set sentinel_apps.data_sanity_module = 'staff_time_heartbeat'
// for the staff_time app row.
//
// NOTE: This module reads from the shared PostgreSQL. Adjust table/column
// names to match what Staff Time Entry actually uses.

async function run(app, pool) {
  try {
    // Adjust this query to match your actual staff time entries table
    const { rows } = await pool.query(`
      SELECT COUNT(*) AS n
      FROM staff_time_entries
      WHERE entry_date >= NOW() - INTERVAL '48 hours'
    `);
    const count = parseInt(rows[0].n, 10);
    if (count === 0) {
      return {
        ok: false,
        summary: 'No staff time entries in 48h - directors may have stopped using the app',
        count
      };
    }
    return {
      ok: true,
      summary: `${count} entries in last 48h`,
      count
    };
  } catch (err) {
    // If the table doesn't exist, skip rather than fail
    if (err.code === '42P01') {
      return { ok: true, summary: 'Table not present (skip)', skipped: true };
    }
    throw err;
  }
}

module.exports = { run };
