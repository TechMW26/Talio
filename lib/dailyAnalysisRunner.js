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

import { formatDesignation, formatDepartments } from '@/lib/formatters';
import {
  appendScreenshotsToComposite,
  getCompositeImageBuffer,
  prepareCompositeForAIAnalysis,
  updateCompositeTileMetadata,
  purgeStitchedScreenshots,
} from '@/lib/screenshotComposite';
import { analyzeStitchedComposite } from '@/lib/dailyProductivityAnalyzer';
import { getDateKeyInTimezone } from '@/lib/timezone';

const REQUIRED_MODELS = [
  'User',
  'Employee',
  'Department',
  'Screenshot',
  'ScreenshotAnalysis',
  'ScreenshotComposite',
  'Task',
  'TaskAssignee',
  'Project',
];

export const DAILY_ANALYSIS_REQUIRED_MODELS = REQUIRED_MODELS;

async function buildEmployeeContext({ models, targetUserId, dateString }) {
  const { User, Task, TaskAssignee } = models;
  const ctx = {
    employeeName: 'Employee',
    employeeRole: 'employee',
    employeeDesignation: '',
    employeeDepartment: '',
    employeeRecordId: null,
    kris: [],
    kpis: [],
    taskContextStr: 'No active tasks assigned',
    dateString,
  };

  const userRecord = await User.findById(targetUserId).populate({
    path: 'employeeId',
    populate: [
      { path: 'designation', select: 'title level levelName' },
      { path: 'department', select: 'name' },
      { path: 'departments', select: 'name' },
    ],
  });

  if (userRecord) {
    ctx.employeeRole = userRecord.role || ctx.employeeRole;
    ctx.employeeName = userRecord.name || ctx.employeeName;

    const emp = userRecord.employeeId;
    if (emp) {
      ctx.employeeName = `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || ctx.employeeName;
      ctx.employeeDesignation = formatDesignation(emp.designation, emp) || emp.jobTitle || '';
      ctx.employeeDepartment = formatDepartments(emp) || '';
      ctx.employeeRecordId = emp._id;

      const manualKRIs = Array.isArray(emp.manualKRIs) ? emp.manualKRIs.filter(Boolean) : [];
      const aiKRIs = Array.isArray(emp.aiGeneratedKRIs)
        ? emp.aiGeneratedKRIs
          .filter((k) => k && (k.title || k.description))
          .map((k) => {
            const parts = [k.title].filter(Boolean);
            if (k.description) parts.push(`\u2014 ${k.description}`);
            if (k.importance && k.importance !== 'medium') parts.push(`(${k.importance} priority)`);
            return parts.join(' ');
          })
          .filter(Boolean)
        : [];
      ctx.kris = [...manualKRIs.map(String), ...aiKRIs].slice(0, 12);

      ctx.kpis = Array.isArray(emp.manualKPIs)
        ? emp.manualKPIs
          .filter((k) => k && (k.name || k.target))
          .map((k) => ({
            name: k.name || '',
            target: k.target || '',
            unit: k.unit || '',
            notes: k.notes || '',
          }))
        : [];

      try {
        const taskAssignments = await TaskAssignee.find({
          user: targetUserId,
          assignmentStatus: { $in: ['pending', 'accepted'] },
        })
          .select('task')
          .lean();
        const taskIds = taskAssignments.map((ta) => ta.task);
        if (taskIds.length > 0) {
          const tasks = await Task.find({
            _id: { $in: taskIds },
            status: { $in: ['todo', 'in-progress', 'review'] },
          })
            .populate('project', 'name')
            .select('title status priority dueDate project tags')
            .sort({ priority: -1, dueDate: 1 })
            .limit(10)
            .lean();
          if (tasks.length > 0) {
            ctx.taskContextStr = tasks
              .map((task, idx) => {
                const projectName = task.project?.name || 'No Project';
                const dueDate = task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'No due date';
                const tags = task.tags?.length ? ` [Tags: ${task.tags.join(', ')}]` : '';
                return `${idx + 1}. [${(task.status || '').toUpperCase()}] "${task.title}" (Project: ${projectName}, Priority: ${task.priority}, Due: ${dueDate})${tags}`;
              })
              .join('\n');
          }
        }
      } catch (err) {
        console.warn('[DailyAnalysisRunner] Failed to load tasks:', err.message);
      }
    }
  }

  return ctx;
}

/**
 * Run the full stitch-then-analyze pipeline for one (user, day).
 *
 * @param {Object} args
 * @param {String} args.userId           Target user.
 * @param {String} args.dateString       'YYYY-MM-DD'.
 * @param {Object} args.models           Tenant models (must include all of REQUIRED_MODELS).
 * @param {Object} args.tenant           { databaseName }.
 * @param {String} args.trigger          Free-form label for logs ('manual' | 'checkout' | 'cron').
 * @param {Boolean} args.forceReanalyze  Re-run AI even if pending screenshot count is 0.
 * @returns {Promise<Object>}            { status, ...counts, analysis? }
 */
export async function runDailyAnalysis({ userId, dateString, models, tenant, trigger = 'manual', forceReanalyze = false }) {
  if (!userId) throw new Error('runDailyAnalysis: userId is required');
  if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    throw new Error('runDailyAnalysis: invalid dateString');
  }
  if (!models || !tenant?.databaseName) {
    throw new Error('runDailyAnalysis: models and tenant.databaseName are required');
  }
  console.log(`[DailyAnalysisRunner:${trigger}] Starting for user ${userId} on ${dateString}`);

  const { Screenshot, ScreenshotAnalysis, ScreenshotComposite } = models;

  const targetUserId = userId.toString();

  console.log(`[DailyAnalysisRunner:${trigger}] Loading pending screenshots...`);
  const pendingScreenshots = await Screenshot.find({
    user: targetUserId,
    dateString,
    analyzed: { $ne: true },
  })
    .sort({ capturedAt: 1 })
    .select('_id user employee capturedAt path imagekitUrl gridfsFileId metadata.mimeType activity.activeApp activity.activeWindow')
    .lean();

  console.log(`[DailyAnalysisRunner:${trigger}] Found ${pendingScreenshots.length} pending screenshots`);
  const existingAnalysis = await ScreenshotAnalysis.findOne({
    user: targetUserId,
    dateString,
  }).lean();

  const existingComposite = await ScreenshotComposite.findOne({
    user: targetUserId,
    dateString,
  }).lean();

  // Nothing to do if there are no pending captures AND nothing has changed
  // since the last analysis. We still allow re-runs when there is an existing
  // composite but no analysis yet (e.g. previous run failed mid-flight).
  if (pendingScreenshots.length === 0 && existingAnalysis && existingComposite && !forceReanalyze) {
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

  const ctx = await buildEmployeeContext({ models, targetUserId, dateString });

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
      models,
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
        models,
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
      models,
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

  const saved = await ScreenshotAnalysis.findOneAndUpdate(
    { user: targetUserId, dateString },
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

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
        models,
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
