/**
 * Thin Screenshots to 3-Minute Intervals
 *
 * Within each ProductivitySession, keeps only screenshots that are ≥3 minutes
 * apart. Removes the extras from:
 *   1. The session's screenshots[] subdocument array
 *   2. The Screenshot collection in MongoDB
 *   3. GridFS storage (via bucket.delete)
 *
 * This ensures consistency: old sessions had ~20 screenshots per 60-min window
 * (1 every 3 minutes). After the 60-min reassembly, some sessions ended up with
 * 50-70 screenshots because the original capture interval was shorter.
 *
 * Run:      node scripts/thin-screenshots-3min.js
 * Dry run:  node scripts/thin-screenshots-3min.js --dry-run
 */

const mongoose = require('mongoose');
require('dotenv').config();

const DRY_RUN = process.argv.includes('--dry-run');
const MIN_GAP_MS = 3 * 60 * 1000; // 3 minutes in milliseconds

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

// ── GridFS helpers ───────────────────────────────────────────────────────────

async function deleteGridFSScreenshots(conn, fileIds) {
  if (!fileIds || fileIds.length === 0) return { deleted: 0, failed: [] };
  const db = conn.db;
  const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: 'screenshots' });
  let deleted = 0;
  const failed = [];
  for (const fid of fileIds) {
    try {
      await bucket.delete(new mongoose.Types.ObjectId(fid));
      deleted++;
    } catch (err) {
      failed.push(fid);
    }
  }
  return { deleted, failed };
}

// ── Schemas (minimal) ────────────────────────────────────────────────────────

const ScreenshotSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  gridfsFileId: mongoose.Schema.Types.ObjectId,
  path: String,
  filename: String,
  capturedAt: { type: Date, required: true },
  dateString: String,
}, { timestamps: true, strict: false });

const ProductivitySessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  date: { type: Date, index: true },
  sessionNumber: Number,
  screenshots: [{
    url: String, path: String, fileId: String,
    capturedAt: Date, timestamp: Date, filename: String,
    captureType: String, isOfflineCapture: Boolean,
    capturedBy: mongoose.Schema.Types.ObjectId, capturedByRole: String
  }],
  startTime: Date,
  endTime: Date,
  estimatedDuration: Number,
  screenshotCount: Number,
  isComplete: Boolean,
  status: String,
  screenshotsDeleted: Boolean,
  analysis: mongoose.Schema.Types.Mixed,
}, { timestamps: true, strict: false });

const TenantCompanySchema = new mongoose.Schema({
  name: String,
  slug: String,
  databaseName: { type: String, required: true },
  isActive: { type: Boolean, default: true },
}, { timestamps: true, strict: false });

// ── Core: thin screenshots to 3-min intervals ───────────────────────────────

/**
 * Given an array of screenshot subdocs, return { keep, remove } where
 * keep has screenshots ≥3 min apart and remove has the rest.
 */
function thinScreenshots(screenshots) {
  if (!screenshots || screenshots.length === 0) return { keep: [], remove: [] };

  // Sort by timestamp
  const sorted = [...screenshots].sort((a, b) => {
    const tA = new Date(a.timestamp || a.capturedAt).getTime();
    const tB = new Date(b.timestamp || b.capturedAt).getTime();
    return tA - tB;
  });

  const keep = [sorted[0]];
  const remove = [];
  let lastKeptTime = new Date(sorted[0].timestamp || sorted[0].capturedAt).getTime();

  for (let i = 1; i < sorted.length; i++) {
    const t = new Date(sorted[i].timestamp || sorted[i].capturedAt).getTime();
    if (t - lastKeptTime >= MIN_GAP_MS) {
      keep.push(sorted[i]);
      lastKeptTime = t;
    } else {
      remove.push(sorted[i]);
    }
  }

  return { keep, remove };
}

// ── Per-tenant processing ────────────────────────────────────────────────────

async function thinTenant(tenantConn, tenantName) {
  const ProductivitySession = tenantConn.model('ProductivitySession', ProductivitySessionSchema);
  const Screenshot = tenantConn.model('Screenshot', ScreenshotSchema);

  // Find all sessions that have screenshots (not already deleted)
  const sessions = await ProductivitySession.find({
    screenshotsDeleted: { $ne: true },
    'screenshots.1': { $exists: true } // at least 2 screenshots (can't thin a single one)
  }).sort({ date: 1, sessionNumber: 1 });

  console.log(`[${tenantName}] Found ${sessions.length} sessions to check`);

  let totalKept = 0;
  let totalRemoved = 0;
  let totalGridFSDeleted = 0;
  let totalDbDeleted = 0;
  let sessionsModified = 0;
  let errors = 0;

  // Collect all GridFS file IDs to delete in bulk at the end
  const allGridFSIdsToDelete = [];
  // Collect all Screenshot collection IDs for DB deletion
  const allScreenshotIdsToDelete = [];

  for (let si = 0; si < sessions.length; si++) {
    const session = sessions[si];

    if ((si + 1) % 200 === 0) {
      console.log(`[${tenantName}] Progress: ${si + 1}/${sessions.length} sessions checked`);
    }

    try {
      const { keep, remove } = thinScreenshots(session.screenshots);

      if (remove.length === 0) {
        totalKept += keep.length;
        continue; // Nothing to thin
      }

      totalKept += keep.length;
      totalRemoved += remove.length;
      sessionsModified++;

      if (DRY_RUN) {
        if (sessionsModified <= 10) {
          const dateStr = session.date ? new Date(session.date).toISOString().slice(0, 10) : '???';
          console.log(`  [${tenantName}] Session ${session._id} (${dateStr} #${session.sessionNumber}): ${session.screenshots.length} -> ${keep.length} screenshots (removing ${remove.length})`);
        }
        continue;
      }

      // Collect GridFS fileIds from removed screenshots
      for (const ss of remove) {
        if (ss.fileId) {
          allGridFSIdsToDelete.push(ss.fileId);
          allScreenshotIdsToDelete.push(ss.fileId);
        }
      }

      // Update session with only kept screenshots
      session.screenshots = keep;
      session.screenshotCount = keep.length;
      if (keep.length > 0) {
        session.startTime = new Date(keep[0].timestamp || keep[0].capturedAt);
        session.endTime = new Date(keep[keep.length - 1].timestamp || keep[keep.length - 1].capturedAt);
        const durationMs = session.endTime.getTime() - session.startTime.getTime();
        session.estimatedDuration = Math.round(durationMs / (1000 * 60)) || 1;
      }
      session.isComplete = keep.length >= 15;
      await session.save();

    } catch (err) {
      console.error(`  [${tenantName}] Error on session ${session._id}: ${err.message}`);
      errors++;
    }
  }

  // Batch delete from GridFS and Screenshot collection
  if (!DRY_RUN && allGridFSIdsToDelete.length > 0) {
    console.log(`[${tenantName}] Deleting ${allGridFSIdsToDelete.length} screenshots from GridFS...`);
    const gridfsResult = await deleteGridFSScreenshots(tenantConn, allGridFSIdsToDelete);
    totalGridFSDeleted = gridfsResult.deleted;
    console.log(`[${tenantName}] GridFS: ${gridfsResult.deleted} deleted, ${gridfsResult.failed.length} failed`);
  }

  if (!DRY_RUN && allScreenshotIdsToDelete.length > 0) {
    // Delete from Screenshot collection by gridfsFileId
    console.log(`[${tenantName}] Deleting ${allScreenshotIdsToDelete.length} from Screenshot collection...`);

    // Batch in chunks of 1000 to avoid huge $in queries
    const CHUNK = 1000;
    for (let i = 0; i < allScreenshotIdsToDelete.length; i += CHUNK) {
      const chunk = allScreenshotIdsToDelete.slice(i, i + CHUNK);
      const result = await Screenshot.deleteMany({ gridfsFileId: { $in: chunk } });
      totalDbDeleted += result.deletedCount;
    }
    console.log(`[${tenantName}] Screenshot collection: ${totalDbDeleted} deleted`);
  }

  return {
    tenant: tenantName,
    sessionsChecked: sessions.length,
    sessionsModified,
    screenshotsKept: totalKept,
    screenshotsRemoved: totalRemoved,
    gridFSDeleted: totalGridFSDeleted,
    dbDeleted: totalDbDeleted,
    errors
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Thin Screenshots to 3-Minute Intervals ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}`);
  console.log(`Min gap: ${MIN_GAP_MS / 1000 / 60} minutes`);
  console.log('');

  const superadminUri = getDatabaseUri('talio_superadmin');
  const superadminConn = await mongoose.createConnection(superadminUri, {
    maxPoolSize: 5, socketTimeoutMS: 30000, connectTimeoutMS: 10000, family: 4,
  }).asPromise();

  const TenantCompany = superadminConn.model('TenantCompany', TenantCompanySchema);
  const tenants = await TenantCompany.find({ isActive: true })
    .select('name slug databaseName').lean();

  console.log(`Found ${tenants.length} active tenant(s)\n`);

  const results = [];
  for (const tenant of tenants) {
    let tenantConn;
    try {
      const tenantUri = getDatabaseUri(tenant.databaseName);
      tenantConn = await mongoose.createConnection(tenantUri, {
        maxPoolSize: 10, socketTimeoutMS: 300000, connectTimeoutMS: 30000,
        serverSelectionTimeoutMS: 30000, family: 4,
      }).asPromise();

      console.log(`── Processing: ${tenant.name} (${tenant.databaseName}) ──`);
      const result = await thinTenant(tenantConn, tenant.name);
      results.push(result);
      console.log(`[${tenant.name}] Done: ${result.sessionsModified}/${result.sessionsChecked} sessions modified, ${result.screenshotsRemoved} screenshots removed (${result.screenshotsKept} kept), GridFS: ${result.gridFSDeleted}, DB: ${result.dbDeleted}, errors: ${result.errors}\n`);
    } catch (err) {
      console.error(`[${tenant.name}] ERROR: ${err.message}`);
      results.push({ tenant: tenant.name, error: err.message });
    } finally {
      if (tenantConn) await tenantConn.close();
    }
  }

  await superadminConn.close();

  console.log('=== Summary ===');
  for (const r of results) {
    if (r.error) {
      console.log(`  ${r.tenant}: ERROR - ${r.error}`);
    } else {
      console.log(`  ${r.tenant}: ${r.sessionsModified} sessions modified, ${r.screenshotsRemoved} removed, ${r.screenshotsKept} kept, GFS=${r.gridFSDeleted}, DB=${r.dbDeleted}`);
    }
  }

  console.log('\nDone. All connections closed.');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
