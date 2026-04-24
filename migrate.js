// Run with: node migrate.js
// Creates tables and seeds the initial app list based on Mary's ecosystem.
// Idempotent - safe to re-run.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./db');

const SEED_APPS = [
  // CRITICAL - daily-driver apps that running the business depends on
  {
    app_key: 'tcc_hub',
    display_name: 'TCC Hub',
    base_url: 'https://tcc-hub.onrender.com',
    login_url: 'https://tcc-hub.onrender.com/api/login',
    criticality: 'critical',
    notes: 'Central SSO hub for all TCC apps'
  },
  {
    app_key: 'payroll_hub',
    display_name: 'TCC Payroll Hub',
    base_url: 'https://tcc-payroll-hub.onrender.com',
    login_url: 'https://tcc-payroll-hub.onrender.com/api/login',
    criticality: 'critical',
    notes: 'Payroll, PTO, Archives, Overtime View'
  },
  {
    app_key: 'compliance',
    display_name: 'TCC Compliance Checker',
    base_url: 'https://tcc-compliance.onrender.com',
    login_url: 'https://tcc-compliance.onrender.com/api/login',
    criticality: 'critical',
    notes: 'Licensing compliance across 5 modes'
  },
  {
    app_key: 'staff_time',
    display_name: 'TCC Staff Time Entry',
    base_url: 'https://tcc-staff-time.onrender.com',
    login_url: 'https://tcc-staff-time.onrender.com/api/login',
    criticality: 'critical',
    notes: 'Director phone app for CACFP time entries'
  },
  {
    app_key: 'cacfp_suite',
    display_name: 'TCC CACFP Suite',
    base_url: 'https://tcc-cacfp-suite.onrender.com',
    login_url: 'https://tcc-cacfp-suite.onrender.com/api/login',
    criticality: 'critical',
    notes: 'Food program; MDE review Aug 4 2026'
  },
  {
    app_key: 'master_organizer',
    display_name: 'TCC Master Organizer',
    base_url: 'https://tcc-master-organizer.onrender.com',
    login_url: 'https://tcc-master-organizer.onrender.com/api/login',
    criticality: 'critical',
    notes: 'Email monitoring for tours + failed payments'
  },
  {
    app_key: 'collections_hub',
    display_name: 'TCC Collections Hub (Billing Intelligence)',
    base_url: 'https://tcc-collections-hub.onrender.com',
    login_url: 'https://tcc-collections-hub.onrender.com/api/login',
    criticality: 'critical',
    notes: 'Billing rules engine, CDC gap detection'
  },
  {
    app_key: 'policy_assistant',
    display_name: 'TCC Policy Assistant',
    base_url: 'https://tcc-policy-assistant-1.onrender.com',
    login_url: 'https://tcc-policy-assistant-1.onrender.com/api/login',
    criticality: 'critical',
    notes: 'Handbook + Licensing + GSRP + CACFP RAG'
  },

  // MINOR - important but not business-critical if down for an hour
  {
    app_key: 'gsq_reflection',
    display_name: 'TCC GSQ Self-Reflection',
    base_url: 'https://tcc-gsq-reflection.onrender.com',
    login_url: 'https://tcc-gsq-reflection.onrender.com/api/login',
    criticality: 'minor',
    notes: 'Director self-reflection, NeDB + Anthropic API'
  },
  {
    app_key: 'leader_review',
    display_name: 'TCC Leader Performance Review',
    base_url: 'https://tcc-quarterly-review.onrender.com',
    login_url: 'https://tcc-quarterly-review.onrender.com/api/login',
    criticality: 'minor',
    notes: 'Quarterly director reviews, owner-only'
  },
  {
    app_key: 'curriculum_generator',
    display_name: 'Faithful Foundations Curriculum',
    base_url: 'https://tcc-curriculum-generator.onrender.com',
    login_url: 'https://tcc-curriculum-generator.onrender.com/api/login',
    criticality: 'minor',
    notes: 'Faith-based ECE curriculum generator'
  },
  {
    app_key: 'budget_tracker',
    display_name: 'TCC Budget Tracker',
    base_url: 'https://tcc-budget-tracker.onrender.com',
    criticality: 'minor',
    notes: 'React static site, Google Sheets sync'
  },
  {
    app_key: 'cda_certificate',
    display_name: 'CDA Certificate Generator',
    base_url: 'https://cda-certificate-generator.onrender.com',
    login_url: 'https://cda-certificate-generator.onrender.com/api/login',
    criticality: 'minor',
    notes: 'CDA 120-hour training certificates, magic link auth'
  },
  {
    app_key: 'msa_hub',
    display_name: 'MSA Hub',
    base_url: 'https://msa-hub.onrender.com',
    login_url: 'https://msa-hub.onrender.com/api/login',
    criticality: 'minor',
    notes: 'Mentor Success Academy central hub'
  },
  {
    app_key: 'selcs_quiz',
    display_name: 'MSA SELCS Quiz',
    base_url: 'https://msa-selcs-quiz.onrender.com',
    criticality: 'minor',
    notes: '72-question leadership expression quiz'
  },
  {
    app_key: 'qif_observation',
    display_name: 'MSA QIF Observation Tool',
    base_url: 'https://msa-qif-observation.onrender.com',
    login_url: 'https://msa-qif-observation.onrender.com/api/login',
    criticality: 'minor',
    notes: '4 domains x 15-min observation sessions'
  },
  {
    app_key: 'mentor_training',
    display_name: 'MSA Mentor Training',
    base_url: 'https://msa-qif-observation.onrender.com/training',
    criticality: 'minor',
    notes: '12-module mentor training, shares repo with QIF'
  },
  {
    app_key: 'mary_vision',
    display_name: 'Mary Vision Center',
    base_url: 'https://mary-vision.onrender.com',
    login_url: 'https://mary-vision.onrender.com/api/login',
    criticality: 'minor',
    notes: 'Personal app, PWA, persistent sessions'
  }
];

async function run() {
  const client = await pool.connect();
  try {
    console.log('Running schema...');
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(schema);
    console.log('✓ Schema applied');

    console.log('Seeding apps...');
    let inserted = 0;
    let skipped = 0;
    for (const app of SEED_APPS) {
      const existing = await client.query(
        'SELECT id FROM sentinel_apps WHERE app_key = $1',
        [app.app_key]
      );
      if (existing.rows.length > 0) {
        skipped++;
        continue;
      }
      await client.query(
        `INSERT INTO sentinel_apps
          (app_key, display_name, base_url, login_url, criticality, notes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [app.app_key, app.display_name, app.base_url, app.login_url || null, app.criticality, app.notes]
      );
      inserted++;
    }
    console.log(`✓ Seeded: ${inserted} inserted, ${skipped} already existed`);
    console.log('Migration complete.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
