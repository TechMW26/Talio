/**
 * Daily productivity analysis runner
 * --------------------------------
 * Single source of truth for the "stitch all the day's screenshots into one
 * composite, then send that composite to the AI in ONE vision call" flow.
 *
 * Used by both the on-demand `/api/productivity/daily/analyze` route and the
 * automated checkout / midnight cron triggers so manual and automated runs
 * are byte-identical in behaviour.
 *
 * Steps performed per (user, dateString):
 *   1. Load any pending Screenshot docs (analyzed=false).
 *   2. Stitch them into the per-(user,day) ScreenshotComposite (creating it
 *      if needed, otherwise appending below the existing tiles). The original
 *      Screenshot rows + GridFS blobs are deleted as soon as their tiles are
 *      safely embedded in the composite.
 *   3. Load the freshly stitched composite buffer.
 *   4. Send the WHOLE composite to the AI in a single vision call, supplying
 *      the previous analysis summary as continuity context.
 *   5. Persist the new analysis (replacing the previous aiAnalysis) and
 *      back-fill per-tile metadata on the composite doc.
 *
 * Returns a summary object (counts + analysis snapshot). Never throws on
 * "nothing to do" — those cases are signalled via `status` so callers can
 * react accordingly.
 */

import { createHash } from 'crypto';
import { getScreenshotStore, findScreenshotComposite, listScreenshotMaintenanceRecords } from '@/lib/platform/firestoreScreenshots.server';
import { getProductivityEmployeeContext } from '@/lib/platform/firestoreProductivityContext.server';
import {
  appendScreenshotsToComposite,
  getCompositeImageBuffer,
  prepareCompositeForAIAnalysis,
  updateCompositeTileMetadata,
  purgeStitchedScreenshots,
} from '@/lib/screenshotComposite';
import { analyzeStitchedComposite } from '@/lib/dailyProductivityAnalyzer';
import { getDateKeyInTimezone } from '@/lib/timezone';

/**
 * Run the full stitch-then-analyze pipeline for one (user, day).
 *
 * @param {Object} args
 * @param {String} args.userId           Target user.
 * @param {String} args.dateString       'YYYY-MM-DD'.
 * @param {Object} args.tenant           { databaseName }.
 * @param {String} args.trigger          Free-form label for logs ('manual' | 'checkout' | 'cron').
 * @param {Boolean} args.forceReanalyze  Re-run AI even if pending screenshot count is 0.
 * @returns {Promise<Object>}            { status, ...counts, analysis? }
 */
export async function runDailyAnalysis({ userId, dateString, tenant, trigger = 'manual', forceReanalyze = false }) {
  if (!userId) throw new Error('runDailyAnalysis: userId is required');
  if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    throw new Error('runDailyAnalysis: invalid dateString');
  }
  if (!tenant?.databaseName) {
    throw new Error('runDailyAnalysis: tenant.databaseName is required');
  }
  console.log(`[DailyAnalysisRunner:${trigger}] Starting for user ${userId} on ${dateString}`);

  const store = await getScreenshotStore(tenant.databaseName);
  const targetUserId = String(userId);
  const scope = [{ field: 'user', operator: '==', value: targetUserId }, { field: 'dateString', operator: '==', value: dateString }];
  const pendingScreenshots = (await listScreenshotMaintenanceRecords(store, 'screenshots', scope)).filter(record => record.analyzed !== true).sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt));
  const existingAnalysis = (await store.list('screenshotanalyses', { filters: scope, limit: 1 })).records[0] || null;
  const existingComposite = await findScreenshotComposite(store, targetUserId, dateString);

  // Nothing to do if there are no pending captures AND nothing has changed
  // since the last analysis. We still allow re-runs when there is an existing
  // composite but no analysis yet (e.g. previous run failed mid-flight).
  const analyzedIds = new Set((existingAnalysis?.analyzedScreenshotIds || []).map(String));
  const compositeFullyAnalyzed = existingComposite?.tiles?.every(tile => analyzedIds.has(String(tile.originalScreenshotId)));
  if (pendingScreenshots.length === 0 && existingAnalysis && existingComposite && compositeFullyAnalyzed && !forceReanalyze) {
    return {
      status: 'noop',
      trigger,
      message: 'No new screenshots since last analysis.',
      pendingCount: 0,
      stitched: 0,
      analysis: {
        id: existingAnalysis._id.toString(),
        lastAnalyzedAt: existingAnalysis.lastAnalyzedAt || null,
        aiAnalysis: existingAnalysis.aiAnalysis || null,
      },
    };
  }

  if (pendingScreenshots.length === 0 && !existingComposite) {
    return {
      status: 'empty',
      trigger,
      message: 'No screenshots captured yet for this day.',
      pendingCount: 0,
      stitched: 0,
    };
  }

  // Safety check: only process screenshots that strictly belong to the
  // requested (user, date) scope.
  const mismatched = pendingScreenshots.find((s) => {
    const screenshotUser = String(s.user || '');
    const screenshotDate = getDateKeyInTimezone(s.capturedAt);
    return screenshotUser !== String(targetUserId) || screenshotDate !== dateString;
  });
  if (mismatched) {
    throw new Error(
      `runDailyAnalysis: scope mismatch for screenshot ${String(mismatched._id)} (expected user=${targetUserId}, date=${dateString}; got user=${String(mismatched.user)}, capturedAt=${new Date(mismatched.capturedAt).toISOString()})`
    );
  }

  const ctx = { ...await getProductivityEmployeeContext(tenant.databaseName, targetUserId), dateString };

  // 1. Stitch any pending screenshots into the composite (and delete the
  //    originals once embedded). Subsequent runs only stitch the new tail.
  let stitched = 0;
  let purgedScreenshots = 0;
  let purgedGridfsBlobs = 0;
  let stitchedScreenshotIdSet = new Set();
  let stitchedComposite = null;
  let stitchedCompositeBuffer = null;

  if (pendingScreenshots.length > 0) {
    const sortedForStitch = [...pendingScreenshots].sort(
      (a, b) => new Date(a.capturedAt) - new Date(b.capturedAt),
    );

    const appendResult = await appendScreenshotsToComposite({
      newScreenshots: sortedForStitch,
      tileMetadata: {}, // metadata is back-filled after the AI call
      tenant,
      userId: targetUserId,
      employeeId: ctx.employeeRecordId || existingComposite?.employee || null,
      dateString,
    });
    const stitchedIds = appendResult.stitchedIds || [];
    stitchedComposite = appendResult.composite || null;
    stitchedCompositeBuffer = appendResult.stitchedBuffer || null;

    stitched = stitchedIds.length;
    stitchedScreenshotIdSet = new Set(stitchedIds.map((id) => String(id)));

    if (stitchedIds.length > 0) {
      const purge = await purgeStitchedScreenshots({
        tenant,
        screenshotIds: stitchedIds,
      });
      purgedScreenshots = purge.deleted;
      purgedGridfsBlobs = purge.gridfsDeleted;
    }
  }

  // 2. Load the (possibly updated) composite + its WebP buffer.
  let composite = stitchedComposite;
  let compositeBuffer = stitchedCompositeBuffer;

  if (!composite || !compositeBuffer) {
    const loadedComposite = await getCompositeImageBuffer({
      tenant,
      userId: targetUserId,
      dateString,
    });
    composite = loadedComposite.composite;
    compositeBuffer = loadedComposite.buffer;
  }

  if (!composite || !compositeBuffer) {
    return {
      status: 'no-composite',
      trigger,
      message: 'Composite could not be built or loaded; skipping AI call.',
      pendingCount: pendingScreenshots.length,
      stitched,
      purgedScreenshots,
      purgedGridfsBlobs,
    };
  }

  // 3. Single AI call over the whole stitched composite.
  const previousSummary = existingAnalysis?.aiAnalysis?.summary || null;
  const tilesForPrompt = (composite.tiles || []).map((t) => ({
    index: t.index,
    capturedAt: t.capturedAt,
    originalScreenshotId: t.originalScreenshotId,
    captureActiveApp: t.captureActiveApp || null,
    captureActiveWindow: t.captureActiveWindow || null,
  }));

  // Convert to grayscale at high quality for the AI call.  Stripping colour
  // data cuts the payload ~60 % while bumping quality to 92 removes the DCT
  // blur that low-quality colour JPEG introduces on on-screen text.  The
  // stored display composite is left unchanged.
  let aiBuffer = compositeBuffer;
  let aiMimeType = composite.mimeType || 'image/jpeg';
  try {
    const prepared = await prepareCompositeForAIAnalysis(compositeBuffer);
    aiBuffer = prepared.buffer;
    aiMimeType = prepared.mimeType;
  } catch (prepErr) {
    console.warn('[DailyAnalysisRunner] grayscale prep failed, using raw buffer:', prepErr?.message);
  }

  let aiAnalysis;
  try {
    aiAnalysis = await analyzeStitchedComposite({
      compositeBuffer: aiBuffer,
      mimeType: aiMimeType,
      tiles: tilesForPrompt,
      columns: composite.columns,
      rows: composite.rows,
      tileWidth: composite.tileWidth,
      tileHeight: composite.tileHeight,
      gap: composite.gap || 0,
      context: ctx,
      previousAnalysisSummary: previousSummary,
    });
  } catch (err) {
    console.error(`[DailyAnalysisRunner:${trigger}] AI analysis failed:`, err?.message || err);
    return {
      status: 'ai-failed',
      trigger,
      error: err?.message || 'AI analysis failed',
      pendingCount: pendingScreenshots.length,
      stitched,
      purgedScreenshots,
      purgedGridfsBlobs,
    };
  }

  // 4. Persist the analysis (REPLACE — single source of truth per day).
  const now = new Date();
  const allTileScreenshotIds = (composite.tiles || []).map((t) => String(t.originalScreenshotId));

  const update = {
    user: targetUserId,
    employee: ctx.employeeRecordId || existingAnalysis?.employee || null,
    dateString,
    date: new Date(`${dateString}T00:00:00.000Z`),
    aiAnalysis,
    analyzedScreenshotIds: allTileScreenshotIds,
    lastAnalyzedAt: now,
    status: 'completed',
    summary: aiAnalysis?.summary || null,
    metrics: {
      score: aiAnalysis?.score ?? null,
      focusScore: aiAnalysis?.focusScore ?? null,
      taskCompletionIndicators: aiAnalysis?.taskCompletionIndicators ?? null,
      timeDistribution: aiAnalysis?.timeDistribution || null,
    },
    provider: 'inference',
  };

  const analysisId = existingAnalysis?._id || createHash('sha256').update(targetUserId + ':' + dateString).digest('hex').slice(0, 24);
  const saved = await store.transaction(async tx => {
    const current = await tx.get('screenshotanalyses', analysisId);
    const latestComposite = await tx.get('screenshotcomposites', composite._id);
    if (String(latestComposite?.gridfsFileId) !== String(composite.gridfsFileId) || latestComposite?.tileCount !== composite.tileCount) throw new Error('Composite changed during analysis; retry with the latest captures');
    if (JSON.stringify(current?.aiAnalysis || null) !== JSON.stringify(existingAnalysis?.aiAnalysis || null)) throw new Error('Daily analysis changed concurrently; retry');
    const next = { ...(current || {}), ...update, _id: analysisId, createdAt: current?.createdAt || now, updatedAt: now };
    if (current) await tx.replace('screenshotanalyses', next); else await tx.create('screenshotanalyses', next);
    return next;
  });

  // 5. Back-fill per-tile metadata onto the composite (drives hover chips
  //    in the UI). Only the tiles we just stitched need their metadata
  //    refreshed; previously-stitched tiles already have theirs.
  try {
    const metadataByScreenshotId = {};
    if (Array.isArray(aiAnalysis?.screenshotAnalysis)) {
      for (const entry of aiAnalysis.screenshotAnalysis) {
        const idx = Number(entry?.index);
        if (!Number.isFinite(idx)) continue;
        const tile = (composite.tiles || []).find((t) => Number(t.index) === idx);
        if (!tile) continue;
        const sid = String(tile.originalScreenshotId);
        if (stitchedScreenshotIdSet.size > 0 && !stitchedScreenshotIdSet.has(sid)) {
          // Skip tiles outside this run's batch unless there's no batch info
          // (e.g. forced re-analyze with zero new screenshots).
          continue;
        }
        metadataByScreenshotId[sid] = {
          activity: entry.activity || null,
          productivity: entry.productivity || null,
          applicationVisible: entry.applicationVisible || null,
          websiteVisible: entry.websiteVisible || null,
        };
      }
    }
    // If we re-analyzed without new tiles, refresh ALL tile metadata.
    if (stitched === 0 && Array.isArray(aiAnalysis?.screenshotAnalysis)) {
      for (const entry of aiAnalysis.screenshotAnalysis) {
        const idx = Number(entry?.index);
        if (!Number.isFinite(idx)) continue;
        const tile = (composite.tiles || []).find((t) => Number(t.index) === idx);
        if (!tile) continue;
        metadataByScreenshotId[String(tile.originalScreenshotId)] = {
          activity: entry.activity || null,
          productivity: entry.productivity || null,
          applicationVisible: entry.applicationVisible || null,
          websiteVisible: entry.websiteVisible || null,
        };
      }
    }
    if (Object.keys(metadataByScreenshotId).length > 0) {
      await updateCompositeTileMetadata({
        tenant,
        userId: targetUserId,
        dateString,
        metadataByScreenshotId,
      });
    }
  } catch (metaErr) {
    console.warn('[DailyAnalysisRunner] Failed to back-fill tile metadata:', metaErr?.message);
  }

  return {
    status: 'analyzed',
    trigger,
    pendingCount: pendingScreenshots.length,
    stitched,
    purgedScreenshots,
    purgedGridfsBlobs,
    analysis: {
      id: saved._id.toString(),
      lastAnalyzedAt: now,
      analyzedScreenshotIds: allTileScreenshotIds,
      aiAnalysis,
    },
  };
}
