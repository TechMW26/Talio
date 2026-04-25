import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import { getTenantModels } from '@/lib/tenantModels';
import { deleteScreenshots as deleteGridFSScreenshots } from '@/lib/gridfs';
import mongoose from 'mongoose';

/**
 * POST /api/activity/screenshots/deduplicate
 * Remove duplicate screenshots that share the same minute-level timestamp for the same user.
 * Keeps the first screenshot per user per minute, deletes the rest from DB + GridFS.
 * Admin/HR only.
 * 
 * Query params:
 *   - userId (optional): Target a specific user. If omitted, deduplicates all users.
 *   - date (optional): Target a specific date (YYYY-MM-DD). If omitted, deduplicates all dates.
 *   - dryRun=true (optional): Preview what would be deleted without actually deleting.
 */
export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request, ['Screenshot', 'User']);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }

    const { user, models } = auth;
    const { Screenshot } = models;

    // Only admin/hr can run deduplication
    if (!['admin', 'hr'].includes(user.role)) {
      return NextResponse.json(
        { success: false, error: 'Only admin/hr can run screenshot deduplication' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const targetUserId = searchParams.get('userId');
    const dateParam = searchParams.get('date');
    const dryRun = searchParams.get('dryRun') === 'true';

    console.log(`[Dedup] Starting screenshot deduplication${dryRun ? ' (DRY RUN)' : ''}...`);
    if (targetUserId) console.log(`[Dedup] Target user: ${targetUserId}`);
    if (dateParam) console.log(`[Dedup] Target date: ${dateParam}`);

    // Build match filter
    const matchFilter = {};
    if (targetUserId) {
      if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
        return NextResponse.json({ success: false, error: 'Invalid userId format' }, { status: 400 });
      }
      matchFilter.user = new mongoose.Types.ObjectId(targetUserId);
    }
    if (dateParam) matchFilter.dateString = dateParam;

    // Aggregation pipeline: Group screenshots by user + minute-truncated timestamp
    // For each group with count > 1, we have duplicates
    const pipeline = [
      ...(Object.keys(matchFilter).length > 0 ? [{ $match: matchFilter }] : []),
      {
        $addFields: {
          // Truncate capturedAt to the minute (zero out seconds and milliseconds)
          minuteKey: {
            $dateFromParts: {
              year: { $year: '$capturedAt' },
              month: { $month: '$capturedAt' },
              day: { $dayOfMonth: '$capturedAt' },
              hour: { $hour: '$capturedAt' },
              minute: { $minute: '$capturedAt' },
              second: 0,
              millisecond: 0
            }
          }
        }
      },
      {
        $sort: { capturedAt: 1 } // Keep the earliest one
      },
      {
        $group: {
          _id: { user: '$user', minute: '$minuteKey' },
          count: { $sum: 1 },
          // Keep first screenshot (earliest), collect rest as duplicates
          keepId: { $first: '$_id' },
          allIds: { $push: '$_id' },
          allImagekitFileIds: { $push: '$imagekitFileId' }, // legacy field, may be null
          allGridfsFileIds: { $push: '$gridfsFileId' },
          allPaths: { $push: '$path' }
        }
      },
      {
        $match: { count: { $gt: 1 } } // Only groups with duplicates
      },
      {
        $sort: { '_id.minute': -1 }
      }
    ];

    const duplicateGroups = await Screenshot.aggregate(pipeline);

    if (duplicateGroups.length === 0) {
      console.log('[Dedup] No duplicate screenshots found.');
      return NextResponse.json({
        success: true,
        message: 'No duplicate screenshots found',
        duplicateGroups: 0,
        screenshotsToDelete: 0
      });
    }

    // Calculate totals
    let totalDuplicates = 0;
    const idsToDelete = [];

    const groupSummaries = [];

    for (const group of duplicateGroups) {
      // All IDs except the first (which we keep)
      const keepId = group.keepId;
      const dupeIds = group.allIds.filter(id => id.toString() !== keepId.toString());
      const dupeCount = dupeIds.length;

      idsToDelete.push(...dupeIds);
      totalDuplicates += dupeCount;

      groupSummaries.push({
        user: group._id.user,
        minute: group._id.minute,
        totalInMinute: group.count,
        duplicatesRemoved: dupeCount,
        keptScreenshotId: keepId.toString()
      });
    }

    console.log(`[Dedup] Found ${duplicateGroups.length} duplicate groups, ${totalDuplicates} screenshots to remove`);

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        message: `Would remove ${totalDuplicates} duplicate screenshots across ${duplicateGroups.length} minute-groups`,
        duplicateGroups: duplicateGroups.length,
        screenshotsToDelete: totalDuplicates,
        groups: groupSummaries.slice(0, 50) // Limit preview to 50 groups
      });
    }

    // === EXECUTE DELETION ===

    // 1. Delete from GridFS (for screenshots stored in GridFS)
    let gridfsDeletedCount = 0;
    const gridfsErrors = [];

    // Collect GridFS file IDs from duplicate groups
    const gridfsFileIdsToDelete = [];
    for (const group of duplicateGroups) {
      for (let i = 0; i < group.allIds.length; i++) {
        if (group.allIds[i].toString() !== group.keepId.toString() && group.allGridfsFileIds[i]) {
          gridfsFileIdsToDelete.push(group.allGridfsFileIds[i]);
        }
      }
    }

    if (gridfsFileIdsToDelete.length > 0) {
      try {
        const result = await deleteGridFSScreenshots(gridfsFileIdsToDelete, { databaseName: auth.tenant.databaseName });
        gridfsDeletedCount = result.successCount || 0;
        if (result.errors?.length) {
          gridfsErrors.push(...result.errors);
        }
        console.log(`[Dedup] Deleted ${gridfsDeletedCount}/${gridfsFileIdsToDelete.length} GridFS files`);
      } catch (err) {
        console.error('[Dedup] GridFS batch delete error:', err.message);
      }
    }

    // 2. Delete from MongoDB (batch in chunks of 1000)
    let dbDeletedCount = 0;
    const DB_BATCH_SIZE = 1000;

    for (let i = 0; i < idsToDelete.length; i += DB_BATCH_SIZE) {
      const batch = idsToDelete.slice(i, i + DB_BATCH_SIZE);
      const result = await Screenshot.deleteMany({ _id: { $in: batch } });
      dbDeletedCount += result.deletedCount;
      console.log(`[Dedup] Deleted DB batch ${Math.floor(i / DB_BATCH_SIZE) + 1}: ${result.deletedCount} records`);
    }

    console.log(`[Dedup] ✅ Deduplication complete: ${dbDeletedCount} DB records, ${gridfsDeletedCount} GridFS files removed`);

    // 3. Clean up ProductivitySession.screenshots arrays that reference deleted screenshots
    let sessionsUpdated = 0;
    try {
      const { ProductivitySession } = await getTenantModels(auth.tenant.databaseName, ['ProductivitySession']);

      // Collect all deleted ImageKit file IDs and paths for matching
      // Collect GridFS file IDs from deleted duplicates for session cleanup
      const deletedGridfsIds = new Set();
      for (const group of duplicateGroups) {
        for (let i = 0; i < group.allIds.length; i++) {
          if (group.allIds[i].toString() !== group.keepId.toString() && group.allGridfsFileIds[i]) {
            deletedGridfsIds.add(group.allGridfsFileIds[i]);
          }
        }
      }

      if (deletedGridfsIds.size > 0) {
        // Find sessions that reference any of the deleted gridfs fileIds
        const affectedSessions = await ProductivitySession.find({
          'screenshots.gridfsFileId': { $in: [...deletedGridfsIds] },
          screenshotsDeleted: { $ne: true }
        });

        for (const session of affectedSessions) {
          const before = session.screenshots.length;
          session.screenshots = session.screenshots.filter(
            s => !s.gridfsFileId || !deletedGridfsIds.has(s.gridfsFileId)
          );
          session.screenshotCount = session.screenshots.length;
          await session.save();
          sessionsUpdated++;
          console.log(`[Dedup] Updated session ${session._id}: ${before} → ${session.screenshots.length} screenshots`);
        }
      }
    } catch (sessionErr) {
      console.error('[Dedup] Session cleanup error (non-fatal):', sessionErr.message);
    }

    return NextResponse.json({
      success: true,
      message: `Removed ${dbDeletedCount} duplicate screenshots`,
      duplicateGroups: duplicateGroups.length,
      dbRecordsDeleted: dbDeletedCount,
      gridfsFilesDeleted: gridfsDeletedCount,
      sessionsUpdated,
      gridfsErrors: gridfsErrors.length > 0 ? gridfsErrors : undefined,
      groups: groupSummaries.slice(0, 50)
    });

  } catch (error) {
    console.error('[Dedup] Deduplication error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to deduplicate screenshots', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/activity/screenshots/deduplicate
 * Preview duplicate screenshot counts without deleting.
 */
export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, ['Screenshot']);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }

    const { user, models } = auth;
    const { Screenshot } = models;

    if (!['admin', 'hr'].includes(user.role)) {
      return NextResponse.json(
        { success: false, error: 'Only admin/hr can view deduplication stats' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const targetUserId = searchParams.get('userId');
    const dateParam = searchParams.get('date');

    const matchFilter = {};
    if (targetUserId) {
      if (mongoose.Types.ObjectId.isValid(targetUserId)) {
        matchFilter.user = new mongoose.Types.ObjectId(targetUserId);
      }
    }
    if (dateParam) matchFilter.dateString = dateParam;

    // Count duplicate groups
    const pipeline = [
      ...(Object.keys(matchFilter).length > 0 ? [{ $match: matchFilter }] : []),
      {
        $addFields: {
          minuteKey: {
            $dateFromParts: {
              year: { $year: '$capturedAt' },
              month: { $month: '$capturedAt' },
              day: { $dayOfMonth: '$capturedAt' },
              hour: { $hour: '$capturedAt' },
              minute: { $minute: '$capturedAt' },
              second: 0,
              millisecond: 0
            }
          }
        }
      },
      {
        $group: {
          _id: { user: '$user', minute: '$minuteKey' },
          count: { $sum: 1 },
          totalSize: { $sum: '$metadata.fileSize' }
        }
      },
      {
        $match: { count: { $gt: 1 } }
      },
      {
        $group: {
          _id: null,
          duplicateGroups: { $sum: 1 },
          totalDuplicates: { $sum: { $subtract: ['$count', 1] } },
          totalWastedBytes: {
            $sum: {
              $multiply: [
                { $subtract: ['$count', 1] },
                { $divide: ['$totalSize', '$count'] }
              ]
            }
          }
        }
      }
    ];

    const [result] = await Screenshot.aggregate(pipeline);

    if (!result) {
      return NextResponse.json({
        success: true,
        duplicateGroups: 0,
        totalDuplicates: 0,
        estimatedWastedStorage: '0 MB'
      });
    }

    const wastedMB = (result.totalWastedBytes / (1024 * 1024)).toFixed(2);

    return NextResponse.json({
      success: true,
      duplicateGroups: result.duplicateGroups,
      totalDuplicates: result.totalDuplicates,
      estimatedWastedStorage: `${wastedMB} MB`
    });

  } catch (error) {
    console.error('[Dedup] Stats error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get deduplication stats', details: error.message },
      { status: 500 }
    );
  }
}
