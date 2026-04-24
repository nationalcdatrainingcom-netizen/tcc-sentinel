-- TCC Sentinel schema
-- Shared PostgreSQL DB with Payroll Hub. Tables are prefixed 'sentinel_' to avoid collisions.

CREATE TABLE IF NOT EXISTS sentinel_apps (
  id SERIAL PRIMARY KEY,
  app_key VARCHAR(100) UNIQUE NOT NULL,      -- short identifier, e.g. 'payroll_hub'
  display_name VARCHAR(200) NOT NULL,        -- human-readable, e.g. 'TCC Payroll Hub'
  base_url TEXT NOT NULL,                    -- https://tcc-payroll-hub.onrender.com
  login_url TEXT,                            -- endpoint for Layer 2 auth test
  login_method VARCHAR(10) DEFAULT 'POST',
  login_payload JSONB,                       -- { "username": "sentinel", "password": "..." } template
  sentinel_user_configured BOOLEAN DEFAULT FALSE,  -- flip true once sentinel@ user exists
  smoke_test_endpoint TEXT,                  -- Layer 3: app-specific /api/health endpoint
  data_sanity_module VARCHAR(100),           -- Layer 4: name of module in checks/sanity/
  criticality VARCHAR(20) DEFAULT 'minor',   -- 'critical' or 'minor'
  enabled BOOLEAN DEFAULT TRUE,              -- pause monitoring without deleting
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sentinel_check_results (
  id SERIAL PRIMARY KEY,
  app_key VARCHAR(100) NOT NULL,
  layer INTEGER NOT NULL,                    -- 1, 2, 3, or 4
  status VARCHAR(20) NOT NULL,               -- 'pass', 'fail', 'skip', 'error'
  response_time_ms INTEGER,
  status_code INTEGER,
  summary TEXT,                              -- one-line human summary
  details JSONB,                             -- full result payload
  checked_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_check_results_app_time
  ON sentinel_check_results(app_key, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_check_results_status
  ON sentinel_check_results(status, checked_at DESC);

CREATE TABLE IF NOT EXISTS sentinel_alerts_sent (
  id SERIAL PRIMARY KEY,
  app_key VARCHAR(100) NOT NULL,
  alert_key VARCHAR(200) NOT NULL,           -- dedupe key: "app_key:layer:fingerprint"
  channel VARCHAR(20) NOT NULL,              -- 'email', 'sms', 'dashboard'
  severity VARCHAR(20) NOT NULL,             -- 'critical' or 'minor'
  summary TEXT,
  sent_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP                      -- set when the check goes back to pass
);

CREATE INDEX IF NOT EXISTS idx_alerts_dedupe
  ON sentinel_alerts_sent(alert_key, sent_at DESC);

-- Optional: record when sentinel itself runs so we can spot gaps
CREATE TABLE IF NOT EXISTS sentinel_run_log (
  id SERIAL PRIMARY KEY,
  run_type VARCHAR(20) NOT NULL,             -- 'hourly', 'daily_deep', 'manual'
  apps_checked INTEGER,
  failures INTEGER,
  duration_ms INTEGER,
  started_at TIMESTAMP DEFAULT NOW(),
  finished_at TIMESTAMP
);
