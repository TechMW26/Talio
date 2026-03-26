/**
 * Reassemble Productivity Sessions into 60-minute windows
 *
 * Current: Sessions group 30 screenshots (~90 min at 3-min intervals)
 * Target:  Sessions group screenshots by 60-minute time windows
 *
 * Logic:
 *   1. For each user+date, load all non-deleted sessions
 *   2. Collect all screenshots from those sessions, sort by timestamp
 *   3. Re-group by 60-minute windows (based on actual clock time, not screenshot count)
 *   4. Update/create/delete sessions to match new grouping
 *   5. Preserve existing analysis data when possible (if session maps 1:1)
 *
 * Run:      node scripts/reassemble-sessions-60min.js
 * Dry run:  node scripts/reassemble-sessions-60min.js --dry-run
 */

const mongoose = require('mongoose');
require('dotenv').config();

const DRY_RUN = process.argv.includes('--dry-run');
const SESSION_WINDOW_MS = 60 * 60 * 1000; // 60 minutes in ms

// ── MongoDB helpers ──────────────────────────────────────────────────────────

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

// ── Schemas (minimal, for script use) ────────────────────────────────────────

const ProductivitySessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', index: true },
  date: { type: Date, index: true },
  sessionNumber: Number,
  sessionTitle: String,
  screenshots: [{
    url: String, path: String, fileId: String,
    capturedAt: Date, timestamp: Date, filename: String,
    captureType: String, isOfflineCapture: Boolean,
    capturedBy: mongoose.Schema.Types.ObjectId, capturedByRole: String
  }],
  startTime: Date,
  endTime: Date,
  totalDuration: Number,
  activeDuration: Number,
  idleDuration: Number,
  estimatedDuration: Number,
  productivityScore: Number,
  apps: [{ name: String, duration: Number, category: String }],
  analysis: mongoose.Schema.Types.Mixed,
  screenshotCount: Number,
  isComplete: Boolean,
  status: String,
  screenshotsDeleted: Boolean,
  screenshotsDeletedAt: Date,
}, { timestamps: true, strict: false });

const TenantCompanySchema = new mongoose.Schema({
  name: String,
  slug: String,
  databaseName: { type: String, required: true },
  isActive: { type: Boolean, default: true },
}, { timestamps: true, strict: false });

// ── 60-minute window grouping ────────────────────────────────────────────────

/**
 * Group screenshots into 60-minute windows based on clock time.
 * Window boundaries are aligned to the hour (e.g., 9:00-10:00, 10:00-11:00).
 */
function groupInto60MinWindows(screenshots) {
  if (!screenshots.length) return [];

  // Sort by timestamp
  const sorted = [...screenshots].sort((a, b) => {
    const tA = new Date(a.timestamp || a.capturedAt).getTime();
    const tB = new Date(b.timestamp || b.capturedAt).getTime();
    return tA - tB;
  });

  const groups = [];
  let currentGroup = [];
  let windowStart = null;

  for (const ss of sorted) {
    const t = new Date(ss.timestamp || ss.capturedAt).getTime();

    if (windowStart === null) {
      // Start first window aligned to the hour
      const d = new Date(t);
      windowStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), 0, 0, 0).getTime();
    }

    // If this screenshot falls outside the current 60-min window, start a new group
    if (t >= windowStart + SESSION_WINDOW_MS) {
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
      }
      // Advance window to the hour containing this screenshot
      const d = new Date(t);
      windowStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), 0, 0, 0).getTime();
      currentGroup = [];
    }

    currentGroup.push(ss);
  }

  // Push final group
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

// ── Per-tenant reassembly ────────────────────────────────────────────────────

async function reassembleTenant(tenantConn, tenantName) {
  const ProductivitySession = tenantConn.model('ProductivitySession', ProductivitySessionSchema);

  // Find all unique user+date combos that have sessions with screenshots
  const userDateCombos = await ProductivitySession.aggregate([
    { $match: { screenshotsDeleted: { $ne: true }, 'screenshots.0': { $exists: true } } },
    { $group: { _id: { user: '$user', date: { $dateToString: { format: '%Y-%m-%d', date: '$date' } } } } },
    { $sort: { '_id.date': 1 } }
  ]).allowDiskUse(true);

  console.log(`[${tenantName}] Found ${userDateCombos.length} user-date combinations to process`);

  let totalUpdated = 0;
  let totalCreated = 0;
  let totalDeleted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (let ci = 0; ci < userDateCombos.length; ci++) {
    const combo = userDateCombos[ci];
    const userId = combo._id.user;
    const dateStr = combo._id.date;
    const dayStart = new Date(dateStr);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    if ((ci + 1) % 50 === 0) console.log(`[${tenantName}] Progress: ${ci + 1}/${userDateCombos.length}`);

    try {

    // Get all existing sessions for this user+date (with screenshots)
    const existingSessions = await ProductivitySession.find({
      user: userId,
      date: { $gte: dayStart, $lt: dayEnd },
      screenshotsDeleted: { $ne: true },
      'screenshots.0': { $exists: true }
    }).sort({ sessionNumber: 1 });

    if (existingSessions.length === 0) continue;

    // Collect ALL screenshots from all sessions, preserving full subdocument
    const allScreenshots = [];
    for (const session of existingSessions) {
      for (const ss of session.screenshots) {
        allScreenshots.push({
          url: ss.url,
          path: ss.path,
          fileId: ss.fileId,
          capturedAt: ss.capturedAt,
          timestamp: ss.timestamp || ss.capturedAt,
          filename: ss.filename,
          captureType: ss.captureType,
          isOfflineCapture: ss.isOfflineCapture,
          capturedBy: ss.capturedBy,
          capturedByRole: ss.capturedByRole,
        });
      }
    }

    // Re-group into 60-minute windows
    const newGroups = groupInto60MinWindows(allScreenshots);

    // Check if regrouping actually changes anything
    if (newGroups.length === existingSessions.length) {
      let same = true;
      for (let i = 0; i < newGroups.length; i++) {
        if (newGroups[i].length !== existingSessions[i].screenshotCount) {
          same = false;
          break;
        }
      }
      if (same) {
        totalSkipped += existingSessions.length;
        continue; // No change needed
      }
    }

    if (DRY_RUN) {
      console.log(`  [${tenantName}] User ${userId} / ${dateStr}: ${existingSessions.length} sessions → ${newGroups.length} sessions (dry run)`);
      for (let i = 0; i < newGroups.length; i++) {
        const g = newGroups[i];
        const firstTs = new Date(g[0].timestamp || g[0].capturedAt);
        const lastTs = new Date(g[g.length - 1].timestamp || g[g.length - 1].capturedAt);
        console.log(`    Session ${i + 1}: ${g.length} screenshots, ${firstTs.toISOString()} → ${lastTs.toISOString()}`);
      }
      continue;
    }

    // Apply new grouping: update existing sessions, create new ones, delete extras
    for (let i = 0; i < newGroups.length; i++) {
      const group = newGroups[i];
      const sessionNum = i + 1;
      const startTime = new Date(group[0].timestamp || group[0].capturedAt);
      const endTime = new Date(group[group.length - 1].timestamp || group[group.length - 1].capturedAt);
      const estimatedDuration = Math.round((endTime.getTime() - startTime.getTime()) / (1000 * 60));

      if (i < existingSessions.length) {
        // Update existing session
        const existing = existingSessions[i];
        existing.sessionNumber = sessionNum;
        existing.screenshots = group;
        existing.screenshotCount = group.length;
        existing.startTime = startTime;
        existing.endTime = endTime;
        existing.estimatedDuration = estimatedDuration || 1;
        existing.isComplete = group.length >= 15; // 60 min / 3 min per capture ~= 20, use 15 as threshold
        // Clear analysis if screenshot composition changed
        if (existing.screenshotCount !== group.length && existing.analysis?.isAnalyzed) {
          existing.analysis.isAnalyzed = false;
          existing.analysis.analyzedAt = null;
        }
        await existing.save();
        totalUpdated++;
      } else {
        // Create new session (we have more groups than existing sessions)
        await ProductivitySession.create({
          user: userId,
          employee: existingSessions[0].employee,
          date: dayStart,
          sessionNumber: sessionNum,
          screenshots: group,
          screenshotCount: group.length,
          startTime,
          endTime,
          estimatedDuration: estimatedDuration || 1,
          isComplete: group.length >= 15,
          status: 'ended',
        });
        totalCreated++;
      }
    }

    // Delete excess sessions (old sessions beyond the new group count)
    for (let i = newGroups.length; i < existingSessions.length; i++) {
      const excess = existingSessions[i];
      console.log(`    [${tenantName}] Deleting excess session #${excess.sessionNumber} (${excess._id})`);
      await ProductivitySession.deleteOne({ _id: excess._id });
      totalDeleted++;
    }

    } catch (comboErr) {
      console.error(`  [${tenantName}] Error processing user ${userId} / ${dateStr}: ${comboErr.message}`);
      totalErrors++;
    }
  }

  return { tenant: tenantName, updated: totalUpdated, created: totalCreated, deleted: totalDeleted, skipped: totalSkipped, errors: totalErrors };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Reassemble Sessions into 60-minute Windows ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}`);
  console.log('');

  // 1. Connect to superadmin to get tenant list
  const superadminUri = getDatabaseUri('talio_superadmin');
  const superadminConn = await mongoose.createConnection(superadminUri, {
    maxPoolSize: 5,
    socketTimeoutMS: 30000,
    connectTimeoutMS: 10000,
    family: 4,
  }).asPromise();

  const TenantCompany = superadminConn.model('TenantCompany', TenantCompanySchema);
  const tenants = await TenantCompany.find({ isActive: true })
    .select('name slug databaseName').lean();

  console.log(`Found ${tenants.length} active tenant(s)\n`);

  // 2. Process each tenant
  const results = [];
  for (const tenant of tenants) {
    let tenantConn;
    try {
      const tenantUri = getDatabaseUri(tenant.databaseName);
      tenantConn = await mongoose.createConnection(tenantUri, {
        maxPoolSize: 10,
        socketTimeoutMS: 300000,
        connectTimeoutMS: 30000,
        serverSelectionTimeoutMS: 30000,
        family: 4,
      }).asPromise();

      console.log(`\n── Processing: ${tenant.name} (${tenant.databaseName}) ──`);
      const result = await reassembleTenant(tenantConn, tenant.name);
      results.push(result);
      console.log(`[${tenant.name}] Done: ${result.updated} updated, ${result.created} created, ${result.deleted} deleted, ${result.skipped} unchanged, ${result.errors} errors`);
    } catch (err) {
      console.error(`[${tenant.name}] ERROR: ${err.message}`);
      results.push({ tenant: tenant.name, error: err.message });
    } finally {
      if (tenantConn) await tenantConn.close();
    }
  }

  await superadminConn.close();

  // Summary
  console.log('\n=== Summary ===');
  for (const r of results) {
    if (r.error) {
      console.log(`  ${r.tenant}: ERROR - ${r.error}`);
    } else {
      console.log(`  ${r.tenant}: ${r.updated} updated, ${r.created} created, ${r.deleted} deleted, ${r.skipped} unchanged, ${r.errors} errors`);
    }
  }

  console.log('\nDone. All connections closed.');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
