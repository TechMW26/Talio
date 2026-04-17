/**
 * Cleanup Analyzed Screenshots
 *
 * Removes Screenshot documents (and their GridFS files) for productivity sessions
 * that have already been analyzed by AI. These documents are no longer needed since
 * the analysis results are preserved in the ProductivitySession.
 *
 * What it deletes:
 *   1. Screenshot DB docs whose time range falls within an analyzed session
 *   2. GridFS files referenced by those Screenshot docs
 *
 * What it preserves:
 *   - ProductivitySession documents (with analysis results intact)
 *   - Screenshots that belong to un-analyzed or incomplete sessions
 *
 * Run:      node scripts/cleanup-analyzed-screenshots.js
 * Dry run:  node scripts/cleanup-analyzed-screenshots.js --dry-run
 */

const mongoose = require('mongoose');
require('dotenv').config();

const DRY_RUN = process.argv.includes('--dry-run');

// ── MongoDB helpers ──────────────────────────────────────────────────

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

// ── GridFS helpers ───────────────────────────────────────────────────

async function deleteGridFSFiles(conn, fileIds) {
    if (!fileIds || fileIds.length === 0) return { deleted: 0, failed: 0 };
    const db = conn.db;
    const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: 'screenshots' });
    let deleted = 0;
    let failed = 0;
    for (const fid of fileIds) {
        try {
            await bucket.delete(new mongoose.Types.ObjectId(fid));
            deleted++;
        } catch (err) {
            failed++;
        }
    }
    return { deleted, failed };
}

// ── Schemas (minimal, for script use) ────────────────────────────────

const ScreenshotSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    gridfsFileId: mongoose.Schema.Types.ObjectId,
    path: String,
    filename: String,
    capturedAt: { type: Date },
    dateString: String,
    sessionId: String,
    metadata: { mimeType: String, width: Number, height: Number, fileSize: Number, format: String },
    markedForDeletion: Boolean
}, { timestamps: true, strict: false });

const ProductivitySessionSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', index: true },
    date: { type: Date, index: true },
    sessionNumber: Number,
    screenshots: [mongoose.Schema.Types.Mixed],
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

// ── Per-tenant cleanup ───────────────────────────────────────────────

async function cleanupTenant(tenantConn, tenantName) {
    const Screenshot = tenantConn.model('Screenshot', ScreenshotSchema);
    const ProductivitySession = tenantConn.model('ProductivitySession', ProductivitySessionSchema);
    const db = tenantConn.db;

    let totalDeleted = 0;
    let totalGridFSDeleted = 0;
    let sessionsProcessed = 0;

    // ── Phase 1: Delete GridFS files for analyzed sessions ──
    const analyzedSessions = await ProductivitySession.find({
        'analysis.isAnalyzed': true,
        startTime: { $exists: true },
        endTime: { $exists: true },
    }).lean();

    console.log(`  Analyzed sessions: ${analyzedSessions.length}`);

    for (const session of analyzedSessions) {
        const query = {};
        if (session.user) query.user = session.user;
        else if (session.employee) query.employee = session.employee;
        else continue;
        query.capturedAt = { $gte: session.startTime, $lte: session.endTime };

        const screenshots = await Screenshot.find(query).select('_id gridfsFileId').lean();
        if (screenshots.length === 0) {
            // Mark as cleaned if not already
            if (!DRY_RUN && !session.screenshotsDeleted) {
                await ProductivitySession.updateOne(
                    { _id: session._id },
                    { $set: { screenshotsDeleted: true, screenshotsDeletedAt: new Date() } }
                );
            }
            continue;
        }

        console.log(`  Session #${session.sessionNumber} (${session.startTime?.toISOString?.()?.slice(0, 10)}): ${screenshots.length} docs to remove`);

        if (!DRY_RUN) {
            // Delete GridFS files
            const gridfsIds = screenshots.filter(s => s.gridfsFileId).map(s => s.gridfsFileId);
            if (gridfsIds.length > 0) {
                const result = await deleteGridFSFiles(tenantConn, gridfsIds);
                totalGridFSDeleted += result.deleted;
            }
            // Delete Screenshot docs
            const ids = screenshots.map(s => s._id);
            const BATCH = 1000;
            for (let i = 0; i < ids.length; i += BATCH) {
                const batch = ids.slice(i, i + BATCH);
                const result = await Screenshot.deleteMany({ _id: { $in: batch } });
                totalDeleted += result.deletedCount;
            }
            // Mark session cleaned
            await ProductivitySession.updateOne(
                { _id: session._id },
                { $set: { screenshotsDeleted: true, screenshotsDeletedAt: new Date() } }
            );
        } else {
            totalDeleted += screenshots.length;
        }
        sessionsProcessed++;
    }

    // ── Phase 2: Remove Screenshot docs with no backing GridFS image ──
    // Check which gridfsFileIds actually exist in GridFS
    const gridfsFileCount = await db.collection('screenshots.files').countDocuments();
    console.log(`  GridFS screenshots.files in bucket: ${gridfsFileCount}`);

    // Get all Screenshot docs that reference a gridfsFileId
    const withGridfs = await Screenshot.find({ gridfsFileId: { $exists: true, $ne: null } })
        .select('_id gridfsFileId').lean();

    let orphanedGridfsRefs = 0;
    if (withGridfs.length > 0 && gridfsFileCount === 0) {
        // GridFS bucket is empty — ALL gridfsFileId references are orphaned
        orphanedGridfsRefs = withGridfs.length;
        console.log(`  GridFS bucket is empty but ${withGridfs.length} Screenshot docs reference gridfsFileIds — all orphaned`);
    } else if (withGridfs.length > 0) {
        // Check each reference against the bucket
        const existingGridfsIds = new Set(
            (await db.collection('screenshots.files').find({}).project({ _id: 1 }).toArray())
                .map(f => f._id.toString())
        );
        const orphanedDocs = withGridfs.filter(s => !existingGridfsIds.has(s.gridfsFileId.toString()));
        orphanedGridfsRefs = orphanedDocs.length;
        if (orphanedDocs.length > 0) {
            console.log(`  ${orphanedDocs.length}/${withGridfs.length} Screenshot docs reference missing GridFS files`);
        }
    }

    // ── Phase 3: Remove all Screenshot docs without any GridFS backing ──
    // These have no image data — they're pure metadata with no actual screenshot
    const noGridfs = await Screenshot.countDocuments({
        $or: [
            { gridfsFileId: { $exists: false } },
            { gridfsFileId: null }
        ]
    });
    console.log(`  Screenshot docs without gridfsFileId: ${noGridfs}`);

    // Total orphaned = docs without gridfsFileId + docs with broken gridfsFileId references
    const totalOrphaned = noGridfs + orphanedGridfsRefs;
    console.log(`  Total orphaned Screenshot docs (no backing image): ${totalOrphaned}`);

    if (totalOrphaned > 0 && !DRY_RUN) {
        // Delete in batches
        const BATCH = 5000;

        // Delete docs without gridfsFileId
        if (noGridfs > 0) {
            const result = await Screenshot.deleteMany({
                $or: [
                    { gridfsFileId: { $exists: false } },
                    { gridfsFileId: null }
                ]
            });
            totalDeleted += result.deletedCount;
            console.log(`  Deleted ${result.deletedCount} Screenshot docs without gridfsFileId`);
        }

        // Delete docs with orphaned gridfsFileId references
        if (orphanedGridfsRefs > 0 && gridfsFileCount === 0) {
            // All gridfs references are orphaned — just delete all that have gridfsFileId
            const result = await Screenshot.deleteMany({
                gridfsFileId: { $exists: true, $ne: null }
            });
            totalDeleted += result.deletedCount;
            console.log(`  Deleted ${result.deletedCount} Screenshot docs with orphaned gridfsFileId`);
        }
    } else if (totalOrphaned > 0) {
        totalDeleted += totalOrphaned;
    }

    // ── Phase 4: Also clean any remaining GridFS files for analyzed sessions ──
    // (in case GridFS files exist but their sessions are analyzed)
    if (gridfsFileCount > 0) {
        // Build set of user+timerange from analyzed sessions
        let analyzedGridfsDeleted = 0;
        for (const session of analyzedSessions) {
            const startMs = new Date(session.startTime).getTime();
            const endMs = new Date(session.endTime).getTime();

            // Find GridFS files uploaded in that window
            const gridfsFiles = await db.collection('screenshots.files').find({
                uploadDate: { $gte: new Date(startMs - 60000), $lte: new Date(endMs + 60000) }
            }).project({ _id: 1 }).toArray();

            if (gridfsFiles.length > 0 && !DRY_RUN) {
                const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: 'screenshots' });
                for (const f of gridfsFiles) {
                    try { await bucket.delete(f._id); analyzedGridfsDeleted++; } catch { }
                }
            } else {
                analyzedGridfsDeleted += gridfsFiles.length;
            }
        }
        if (analyzedGridfsDeleted > 0) {
            totalGridFSDeleted += analyzedGridfsDeleted;
            console.log(`  Cleaned ${analyzedGridfsDeleted} GridFS files from analyzed sessions`);
        }
    }

    // Final count
    const remaining = await Screenshot.countDocuments();
    console.log(`  Screenshot docs remaining after cleanup: ${remaining}`);

    return {
        tenant: tenantName,
        analyzedSessions: analyzedSessions.length,
        sessionsProcessed,
        screenshotsDeleted: totalDeleted,
        gridfsDeleted: totalGridFSDeleted,
        orphanedDocs: totalOrphaned,
    };
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  Cleanup Analyzed Screenshots${DRY_RUN ? ' (DRY RUN)' : ''}`);
    console.log(`${'='.repeat(60)}\n`);

    // Connect to superadmin DB to list tenants
    const superadminUri = getDatabaseUri('talio_superadmin');
    const superConn = await mongoose.createConnection(superadminUri).asPromise();
    const TenantCompany = superConn.model('TenantCompany', TenantCompanySchema);

    const tenants = await TenantCompany.find({ isActive: true }).lean();
    console.log(`Found ${tenants.length} active tenants\n`);

    const results = [];

    for (const tenant of tenants) {
        const tenantName = tenant.name || tenant.slug || tenant.databaseName;
        console.log(`\n── ${tenantName} (${tenant.databaseName}) ──`);

        let tenantConn;
        try {
            tenantConn = await mongoose.createConnection(getDatabaseUri(tenant.databaseName)).asPromise();
            const result = await cleanupTenant(tenantConn, tenantName);
            results.push(result);
        } catch (err) {
            console.error(`[${tenantName}] ERROR: ${err.message}`);
            results.push({ tenant: tenantName, error: err.message });
        } finally {
            if (tenantConn) await tenantConn.close();
        }
    }

    // Summary
    console.log(`\n${'='.repeat(60)}`);
    console.log('  SUMMARY');
    console.log(`${'='.repeat(60)}`);

    let grandTotalScreenshots = 0;
    let grandTotalGridFS = 0;
    let grandTotalOrphaned = 0;
    let grandTotalSessions = 0;

    for (const r of results) {
        if (r.error) {
            console.log(`  ❌ ${r.tenant}: ${r.error}`);
            continue;
        }
        console.log(`  ${r.tenant}: ${r.screenshotsDeleted} screenshot docs removed, ${r.gridfsDeleted} GridFS files, ${r.sessionsProcessed}/${r.analyzedSessions} sessions cleaned, ${r.orphanedDocs} orphaned docs`);
        grandTotalScreenshots += r.screenshotsDeleted;
        grandTotalGridFS += r.gridfsDeleted;
        grandTotalOrphaned += r.orphanedDocs;
        grandTotalSessions += r.sessionsProcessed;
    }

    console.log(`\n  TOTAL: ${grandTotalScreenshots} screenshot docs, ${grandTotalGridFS} GridFS files, ${grandTotalSessions} sessions cleaned, ${grandTotalOrphaned} old orphans`);
    if (DRY_RUN) console.log('\n  🔍 DRY RUN — no data was actually deleted. Run without --dry-run to execute.\n');

    await superConn.close();
    process.exit(0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
