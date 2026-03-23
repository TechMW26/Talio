/**
 * Screenshot Deduplication Script
 * 
 * Removes duplicate screenshots that share the same minute-level timestamp for the same user.
 * Keeps the first (earliest) screenshot per user per minute, deletes the rest from DB + ImageKit.
 * Also rebuilds ProductivitySession screenshot arrays after cleanup.
 * 
 * Run: node scripts/deduplicate-screenshots.js
 * Dry run: node scripts/deduplicate-screenshots.js --dry-run
 */

const mongoose = require('mongoose');
const ImageKit = require('imagekit');
require('dotenv').config();

const DRY_RUN = process.argv.includes('--dry-run');

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

// ── ImageKit setup ───────────────────────────────────────────────────────────

let imagekit = null;
function getImageKit() {
  if (!imagekit) {
    const publicKey = process.env.IMAGEKIT_PUBLIC_KEY;
    const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
    const urlEndpoint = process.env.IMAGEKIT_URL_ENDPOINT;
    if (!publicKey || !privateKey || !urlEndpoint) {
      console.warn('[Dedup] ⚠️ ImageKit not configured — will only clean DB');
      return null;
    }
    imagekit = new ImageKit({ publicKey, privateKey, urlEndpoint });
  }
  return imagekit;
}

async function bulkDeleteFromImageKit(fileIds) {
  const ik = getImageKit();
  if (!ik || fileIds.length === 0) return { deleted: 0, failed: [] };
  let deleted = 0;
  const failed = [];
  const BATCH = 100; // ImageKit API limit
  for (let i = 0; i < fileIds.length; i += BATCH) {
    const batch = fileIds.slice(i, i + BATCH);
    try {
      const result = await ik.bulkDeleteFiles(batch);
      const successCount = result.successfullyDeletedFileIds?.length || 0;
      deleted += successCount;
      // Track files that weren't in the success list (partial failure)
      if (successCount < batch.length) {
        const successSet = new Set(result.successfullyDeletedFileIds || []);
        for (const fid of batch) {
          if (!successSet.has(fid)) failed.push(fid);
        }
      }
      console.log(`  [ImageKit] Deleted batch ${Math.floor(i / BATCH) + 1}: ${successCount}/${batch.length} files`);
    } catch (err) {
      console.error(`  [ImageKit] Batch delete failed, trying individually...`, err.message);
      for (const fid of batch) {
        try {
          await ik.deleteFile(fid);
          deleted++;
        } catch (singleErr) {
          console.warn(`  [ImageKit] Failed to delete ${fid}: ${singleErr.message}`);
          failed.push(fid);
        }
      }
    }
  }
  if (failed.length > 0) {
    console.warn(`  [ImageKit] ⚠️ ${failed.length} file(s) could not be deleted`);
  }
  return { deleted, failed };
}

// ── Schemas (minimal, for script use) ────────────────────────────────────────

const ScreenshotSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  gridfsFileId: mongoose.Schema.Types.ObjectId,
  imagekitFileId: String,
  imagekitUrl: String,
  path: String,
  filename: String,
  capturedAt: { type: Date, required: true },
  dateString: { type: String, index: true },
  metadata: { mimeType: String, width: Number, height: Number, fileSize: Number, format: String, storage: String },
  activity: { activeWindow: String, activeApp: String, keystrokes: Number, mouseClicks: Number, mouseMovements: Number, isIdle: Boolean },
  sessionId: String,
  markedForDeletion: Boolean
}, { timestamps: true, strict: false });

const ProductivitySessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', index: true },
  date: { type: Date, index: true },
  sessionNumber: Number,
  screenshots: [{ url: String, path: String, fileId: String, capturedAt: Date, timestamp: Date, filename: String }],
  startTime: Date,
  endTime: Date,
  screenshotCount: Number,
  screenshotsDeleted: Boolean,
  screenshotsDeletedAt: Date,
  analysis: mongoose.Schema.Types.Mixed,
  isComplete: Boolean,
  status: String,
}, { timestamps: true, strict: false });

const TenantCompanySchema = new mongoose.Schema({
  name: String,
  slug: String,
  databaseName: { type: String, required: true },
  isActive: { type: Boolean, default: true },
}, { timestamps: true, strict: false });

// ── Main ─────────────────────────────────────────────────────────────────────

async function deduplicateTenant(tenantConn, tenantName) {
  const Screenshot = tenantConn.model('Screenshot', ScreenshotSchema);
  const ProductivitySession = tenantConn.model('ProductivitySession', ProductivitySessionSchema);

  // Aggregation: group by user + minute-truncated timestamp, find groups with count > 1
  const pipeline = [
    {
      $addFields: {
        minuteKey: {
          $dateFromParts: {
            year: { $year: '$capturedAt' },
            month: { $month: '$capturedAt' },
            day: { $dayOfMonth: '$capturedAt' },
            hour: { $hour: '$capturedAt' },
            minute: { $minute: '$capturedAt' },
            second: 0, millisecond: 0
          }
        }
      }
    },
    { $sort: { capturedAt: 1 } },
    {
      $group: {
        _id: { user: '$user', minute: '$minuteKey' },
        count: { $sum: 1 },
        keepId: { $first: '$_id' },
        allIds: { $push: '$_id' },
        allImagekitFileIds: { $push: '$imagekitFileId' },
        totalSize: { $sum: '$metadata.fileSize' }
      }
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { '_id.minute': -1 } }
  ];

  console.log(`\n[${tenantName}] Running dedup aggregation...`);
  const duplicateGroups = await Screenshot.aggregate(pipeline).allowDiskUse(true);

  if (duplicateGroups.length === 0) {
    console.log(`[${tenantName}] ✅ No duplicates found.`);
    return { tenant: tenantName, duplicateGroups: 0, deleted: 0, imagekitDeleted: 0, sessionsUpdated: 0 };
  }

  // Collect IDs to delete (everything except first per group)
  const idsToDelete = [];
  const imagekitIdsToDelete = [];
  let totalDupes = 0;
  let totalWastedBytes = 0;

  for (const group of duplicateGroups) {
    const keepId = group.keepId.toString();
    for (let i = 0; i < group.allIds.length; i++) {
      if (group.allIds[i].toString() !== keepId) {
        idsToDelete.push(group.allIds[i]);
        if (group.allImagekitFileIds[i]) {
          imagekitIdsToDelete.push(group.allImagekitFileIds[i]);
        }
        totalDupes++;
      }
    }
    // Estimate wasted bytes (avg size * dupe count)
    const avgSize = group.totalSize / group.count;
    totalWastedBytes += avgSize * (group.count - 1);
  }

  const wastedMB = (totalWastedBytes / (1024 * 1024)).toFixed(2);
  console.log(`[${tenantName}] Found ${duplicateGroups.length} duplicate groups, ${totalDupes} screenshots to remove (~${wastedMB} MB wasted)`);
  console.log(`[${tenantName}] ImageKit files to delete: ${imagekitIdsToDelete.length}`);

  if (DRY_RUN) {
    console.log(`[${tenantName}] 🔍 DRY RUN — no deletions performed.`);
    return { tenant: tenantName, duplicateGroups: duplicateGroups.length, deleted: 0, imagekitDeleted: 0, sessionsUpdated: 0, wouldDelete: totalDupes, wastedMB };
  }

  // 1. Delete from ImageKit
  const imagekitResult = await bulkDeleteFromImageKit(imagekitIdsToDelete);
  const imagekitDeleted = imagekitResult.deleted;
  const imagekitFailed = imagekitResult.failed;
  console.log(`[${tenantName}] ImageKit: deleted ${imagekitDeleted} files${imagekitFailed.length > 0 ? `, ${imagekitFailed.length} failed` : ''}`);

  // 2. Delete from MongoDB (batch)
  let dbDeleted = 0;
  const DB_BATCH = 1000;
  for (let i = 0; i < idsToDelete.length; i += DB_BATCH) {
    const batch = idsToDelete.slice(i, i + DB_BATCH);
    const result = await Screenshot.deleteMany({ _id: { $in: batch } });
    dbDeleted += result.deletedCount;
  }
  console.log(`[${tenantName}] MongoDB: deleted ${dbDeleted} screenshot records`);

  // 3. Clean up ProductivitySession.screenshots arrays
  let sessionsUpdated = 0;
  const deletedFileIdSet = new Set(imagekitIdsToDelete.filter(Boolean));

  if (deletedFileIdSet.size > 0) {
    const affectedSessions = await ProductivitySession.find({
      'screenshots.fileId': { $in: [...deletedFileIdSet] },
      screenshotsDeleted: { $ne: true }
    });

    for (const session of affectedSessions) {
      const before = session.screenshots.length;
      session.screenshots = session.screenshots.filter(
        s => !s.fileId || !deletedFileIdSet.has(s.fileId)
      );
      session.screenshotCount = session.screenshots.length;
      if (session.screenshots.length > 0) {
        session.startTime = session.screenshots[0].capturedAt || session.screenshots[0].timestamp;
        session.endTime = session.screenshots[session.screenshots.length - 1].capturedAt || session.screenshots[session.screenshots.length - 1].timestamp;
      }
      await session.save();
      sessionsUpdated++;
      console.log(`  [Session ${session._id}] ${before} → ${session.screenshots.length} screenshots`);
    }
  }

  // 4. Force recompile all non-deleted sessions for today and recent dates
  // This re-groups the remaining screenshots into sessions of 30
  console.log(`[${tenantName}] Recompiling recent sessions...`);
  let sessionsRecompiled = 0;
  try {
    // Get the date range from the duplicate groups
    const dates = new Set();
    for (const group of duplicateGroups) {
      const d = new Date(group._id.minute);
      dates.add(d.toISOString().split('T')[0]);
    }

    for (const dateStr of dates) {
      const dayStart = new Date(dateStr);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      // Get unique user IDs that had duplicates on this date
      const userIds = [...new Set(
        duplicateGroups
          .filter(g => {
            const d = new Date(g._id.minute);
            return d.toISOString().split('T')[0] === dateStr;
          })
          .map(g => g._id.user.toString())
      )];

      for (const uid of userIds) {
        // Get remaining screenshots for this user on this date
        const remaining = await Screenshot.find({
          user: new mongoose.Types.ObjectId(uid),
          capturedAt: { $gte: dayStart, $lt: dayEnd }
        }).sort({ capturedAt: 1 }).lean();

        // Get existing sessions for this user on this date
        const existingSessions = await ProductivitySession.find({
          user: new mongoose.Types.ObjectId(uid),
          date: { $gte: dayStart, $lt: dayEnd },
          screenshotsDeleted: { $ne: true }
        }).sort({ sessionNumber: 1 });

        // Regroup into sessions of 30
        const SCREENSHOTS_PER_SESSION = 30;
        const groups = [];
        for (let i = 0; i < remaining.length; i += SCREENSHOTS_PER_SESSION) {
          groups.push(remaining.slice(i, i + SCREENSHOTS_PER_SESSION));
        }

        // Update or create sessions
        for (let sIdx = 0; sIdx < groups.length; sIdx++) {
          const group = groups[sIdx];
          const sessionNum = sIdx + 1;
          const mappedScreenshots = group.map(ss => ({
            path: ss.imagekitUrl || ss.path || `/api/activity/screenshot?id=${ss._id}`,
            url: ss.imagekitUrl || ss.path || `/api/activity/screenshot?id=${ss._id}`,
            fileId: ss.imagekitFileId || null,
            timestamp: ss.capturedAt,
            capturedAt: ss.capturedAt,
            filename: ss.filename
          }));

          const existing = existingSessions.find(s => s.sessionNumber === sessionNum);
          if (existing) {
            existing.screenshots = mappedScreenshots;
            existing.screenshotCount = mappedScreenshots.length;
            existing.startTime = group[0].capturedAt;
            existing.endTime = group[group.length - 1].capturedAt;
            await existing.save();
          } else {
            await ProductivitySession.create({
              user: new mongoose.Types.ObjectId(uid),
              date: dayStart,
              sessionNumber: sessionNum,
              screenshots: mappedScreenshots,
              screenshotCount: mappedScreenshots.length,
              startTime: group[0].capturedAt,
              endTime: group[group.length - 1].capturedAt,
              status: 'ended'
            });
          }
          sessionsRecompiled++;
        }

        // Delete excess sessions (if we now have fewer groups than before)
        for (const es of existingSessions) {
          if (es.sessionNumber > groups.length && !es.analysis?.isAnalyzed) {
            console.log(`  [Session ${es._id}] Removing excess empty session #${es.sessionNumber}`);
            await ProductivitySession.deleteOne({ _id: es._id });
          }
        }
      }
    }
  } catch (recompileErr) {
    console.error(`[${tenantName}] Session recompile error (non-fatal):`, recompileErr.message);
  }

  console.log(`[${tenantName}] ✅ Done: ${dbDeleted} DB records deleted, ${imagekitDeleted} ImageKit files, ${sessionsUpdated} sessions cleaned, ${sessionsRecompiled} sessions recompiled`);
  if (imagekitFailed.length > 0) {
    console.warn(`[${tenantName}] ⚠️ ${imagekitFailed.length} ImageKit file(s) failed to delete: ${imagekitFailed.slice(0, 10).join(', ')}${imagekitFailed.length > 10 ? '...' : ''}`);
  }

  return {
    tenant: tenantName,
    duplicateGroups: duplicateGroups.length,
    deleted: dbDeleted,
    imagekitDeleted,
    imagekitFailed: imagekitFailed.length,
    sessionsUpdated,
    sessionsRecompiled,
    wastedMB
  };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Screenshot Deduplication Script');
  console.log(`  Mode: ${DRY_RUN ? '🔍 DRY RUN (no changes)' : '🗑️ LIVE (will delete duplicates)'}`);
  console.log('═══════════════════════════════════════════════════════\n');

  // Connect to superadmin to get all tenant databases
  const superadminUri = getDatabaseUri('talio_superadmin');
  const superadminConn = await mongoose.createConnection(superadminUri, {
    maxPoolSize: 5,
    socketTimeoutMS: 30000,
    connectTimeoutMS: 10000,
    family: 4,
  }).asPromise();

  console.log('Connected to superadmin DB');

  const TenantCompany = superadminConn.model('TenantCompany', TenantCompanySchema);
  const tenants = await TenantCompany.find({ isActive: true }).select('name slug databaseName').lean();

  console.log(`Found ${tenants.length} active tenant(s):\n`);
  for (const t of tenants) {
    console.log(`  - ${t.name} (${t.databaseName})`);
  }

  const results = [];

  for (const tenant of tenants) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Processing: ${tenant.name} (${tenant.databaseName})`);
    console.log('─'.repeat(60));

    let tenantConn;
    try {
      const tenantUri = getDatabaseUri(tenant.databaseName);
      tenantConn = await mongoose.createConnection(tenantUri, {
        maxPoolSize: 10,
        socketTimeoutMS: 60000,
        connectTimeoutMS: 15000,
        family: 4,
      }).asPromise();

      const result = await deduplicateTenant(tenantConn, tenant.name);
      results.push(result);
    } catch (err) {
      console.error(`[${tenant.name}] ❌ Error:`, err.message);
      results.push({ tenant: tenant.name, error: err.message });
    } finally {
      if (tenantConn) await tenantConn.close();
    }
  }

  // Summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  SUMMARY');
  console.log('═'.repeat(60));

  let totalDeleted = 0;
  let totalImagekit = 0;
  let totalSessions = 0;
  let totalRecompiled = 0;

  for (const r of results) {
    if (r.error) {
      console.log(`  ❌ ${r.tenant}: ERROR - ${r.error}`);
    } else {
      const action = DRY_RUN ? `would delete ${r.wouldDelete || 0}` : `deleted ${r.deleted}`;
      console.log(`  ${r.deleted > 0 || (r.wouldDelete || 0) > 0 ? '🗑️' : '✅'} ${r.tenant}: ${r.duplicateGroups} groups, ${action} screenshots (~${r.wastedMB || 0} MB), ${r.sessionsRecompiled || 0} sessions recompiled`);
      totalDeleted += r.deleted || 0;
      totalImagekit += r.imagekitDeleted || 0;
      totalSessions += r.sessionsUpdated || 0;
      totalRecompiled += r.sessionsRecompiled || 0;
    }
  }

  if (!DRY_RUN) {
    console.log(`\n  TOTAL: ${totalDeleted} DB records, ${totalImagekit} ImageKit files, ${totalSessions} sessions cleaned, ${totalRecompiled} sessions recompiled`);
  }

  await superadminConn.close();
  console.log('\nDone. All connections closed.');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
