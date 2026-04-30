/**
 * Reset Productivity AI Analysis
 * --------------------------------
 * - Deletes all ScreenshotAnalysis docs (per-day MIRA results) across every
 *   active tenant database.
 * - Marks every Screenshot as `analyzed: false` and clears `analysisData` so
 *   they reappear in the "Pending Captures" grid and the next "Analyse with
 *   MIRA" press will reprocess them.
 *
 * Usage:
 *   node scripts/reset-productivity-analysis.js                # all tenants
 *   node scripts/reset-productivity-analysis.js --dry-run      # report only
 *   node scripts/reset-productivity-analysis.js --tenant=slug  # one tenant
 */

const mongoose = require('mongoose');
require('dotenv').config();

const DRY_RUN = process.argv.includes('--dry-run');
const TENANT_FILTER = (() => {
  const arg = process.argv.find((a) => a.startsWith('--tenant='));
  return arg ? arg.split('=')[1] : null;
})();

const MONGODB_URI = process.env.MONGODB_URI;

function getClusterBaseUri() {
  if (!MONGODB_URI) throw new Error('MONGODB_URI not set');
  const match = MONGODB_URI.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)\/?([^?]*)?(\?.*)?$/);
  if (!match) throw new Error('Invalid MONGODB_URI format');
  return { baseUri: match[1], options: match[3] || '' };
}

function getDatabaseUri(databaseName) {
  const { baseUri, options } = getClusterBaseUri();
  return `${baseUri}/${databaseName}${options}`;
}

const TenantCompanySchema = new mongoose.Schema({
  name: String,
  slug: String,
  databaseName: { type: String, required: true },
  isActive: { type: Boolean, default: true },
}, { timestamps: true, strict: false });

async function resetTenant(tenantConn, tenantName) {
  const db = tenantConn.db;
  const screenshots = db.collection('screenshots');
  const analyses = db.collection('screenshotanalyses');

  const screenshotsTotal = await screenshots.countDocuments({});
  const analyzedCount = await screenshots.countDocuments({ analyzed: true });
  const analysisCount = await analyses.countDocuments({});

  console.log(`[${tenantName}] screenshots=${screenshotsTotal} analyzed=${analyzedCount} analysisDocs=${analysisCount}`);

  if (DRY_RUN) {
    return { tenant: tenantName, screenshotsTotal, analyzedCount, analysisCount, deleted: 0, updated: 0 };
  }

  const updRes = await screenshots.updateMany(
    {},
    {
      $set: { analyzed: false },
      $unset: {
        analysisData: '',
        analyzedAt: '',
        analysisVersion: '',
      },
    },
  );

  const delRes = await analyses.deleteMany({});

  console.log(`[${tenantName}] reset done: marked ${updRes.modifiedCount} screenshots pending, deleted ${delRes.deletedCount} analysis docs`);

  return {
    tenant: tenantName,
    screenshotsTotal,
    analyzedCount,
    analysisCount,
    deleted: delRes.deletedCount,
    updated: updRes.modifiedCount,
  };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Productivity AI Analysis Reset');
  console.log(`  Mode: ${DRY_RUN ? '🔍 DRY RUN (no changes)' : '🗑️  LIVE (will reset)'}`);
  if (TENANT_FILTER) console.log(`  Tenant filter: ${TENANT_FILTER}`);
  console.log('═══════════════════════════════════════════════════════\n');

  const superadminUri = getDatabaseUri('talio_superadmin');
  const superadminConn = await mongoose.createConnection(superadminUri, {
    maxPoolSize: 5, socketTimeoutMS: 30000, connectTimeoutMS: 10000, family: 4,
  }).asPromise();

  const TenantCompany = superadminConn.model('TenantCompany', TenantCompanySchema);
  const query = { isActive: true };
  if (TENANT_FILTER) query.slug = TENANT_FILTER;
  const tenants = await TenantCompany.find(query).select('name slug databaseName').lean();

  if (tenants.length === 0) {
    console.log('No matching tenants found.');
    await superadminConn.close();
    return;
  }

  console.log(`Found ${tenants.length} tenant(s):\n`);
  for (const t of tenants) console.log(`  - ${t.name} (${t.databaseName})`);

  const results = [];
  for (const tenant of tenants) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Processing: ${tenant.name} (${tenant.databaseName})`);
    console.log('─'.repeat(60));

    let tenantConn;
    try {
      tenantConn = await mongoose.createConnection(getDatabaseUri(tenant.databaseName), {
        maxPoolSize: 10, socketTimeoutMS: 60000, connectTimeoutMS: 15000, family: 4,
      }).asPromise();
      const result = await resetTenant(tenantConn, tenant.name);
      results.push(result);
    } catch (err) {
      console.error(`[${tenant.name}] ❌ Error:`, err.message);
      results.push({ tenant: tenant.name, error: err.message });
    } finally {
      if (tenantConn) await tenantConn.close();
    }
  }

  await superadminConn.close();

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  SUMMARY');
  console.log('═'.repeat(60));
  let totalScreens = 0, totalUpdated = 0, totalDeleted = 0;
  for (const r of results) {
    if (r.error) {
      console.log(`  ❌ ${r.tenant}: ${r.error}`);
      continue;
    }
    totalScreens += r.screenshotsTotal || 0;
    totalUpdated += r.updated || 0;
    totalDeleted += r.deleted || 0;
    console.log(`  ✓ ${r.tenant}: ${DRY_RUN ? `would mark ${r.analyzedCount} screenshots pending and delete ${r.analysisCount} analyses` : `marked ${r.updated} screenshots pending, deleted ${r.deleted} analyses`}`);
  }
  console.log(`\nTotal screenshots scanned: ${totalScreens}`);
  console.log(`Screenshots reset to pending: ${totalUpdated}`);
  console.log(`Analysis docs deleted: ${totalDeleted}`);
  console.log('═══════════════════════════════════════════════════════');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
