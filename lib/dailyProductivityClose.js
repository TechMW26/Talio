/**
 * End-of-day analyze + purge for a single user/day.
 * Used by both the cron job and (optionally) the in-app daily analyze flow.
 *
 * Steps:
 *   1. Collect ALL screenshots for the user/day
 *   2. Analyze any pending ones (re-using the existing per-day aggregate)
 *   3. Persist the merged ScreenshotAnalysis
 *   4. Delete every screenshot for that day from DB + GridFS + filesystem
 *
 * NOTE: this function is tenant-aware via the models and databaseName passed in.
 */

import { unlink } from 'fs/promises';
import path from 'path';
import { formatDesignation, formatDepartments } from '@/lib/formatters';
import { analyzeScreenshotBatch, mergeDailyAnalyses } from '@/lib/dailyProductivityAnalyzer';
import { deleteScreenshots } from '@/lib/gridfs';

async function gatherEmployeeContext({ userId, models }) {
  const { User, Task, TaskAssignee } = models;

  let employeeName = 'Employee';
  let employeeRole = 'employee';
  let employeeDesignation = '';
  let employeeDepartment = '';
  let manualKRIs = [];
  let aiKRIs = [];
  let employeeRecordId = null;

  const userRecord = await User.findById(userId).populate({
    path: 'employeeId',
    populate: [
      { path: 'designation', select: 'title level levelName' },
      { path: 'department', select: 'name' },
      { path: 'departments', select: 'name' },
    ],
  });
  if (userRecord) {
    employeeRole = userRecord.role || employeeRole;
    if (userRecord.employeeId) {
      const emp = userRecord.employeeId;
      employeeName = `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || userRecord.name || 'Employee';
      employeeDesignation = formatDesignation(emp.designation, emp) || emp.jobTitle || '';
      employeeDepartment = formatDepartments(emp) || '';
      manualKRIs = Array.isArray(emp.manualKRIs) ? emp.manualKRIs.filter(Boolean) : [];
      aiKRIs = Array.isArray(emp.aiGeneratedKRIs)
        ? emp.aiGeneratedKRIs.map((item) => item?.title).filter(Boolean)
        : [];
      employeeRecordId = emp._id;
    } else {
      employeeName = userRecord.name || 'Employee';
    }
  }

  let taskContextStr = 'No active tasks assigned';
  if (employeeRecordId && Task && TaskAssignee) {
    try {
      const assignments = await TaskAssignee.find({
        user: employeeRecordId,
        assignmentStatus: { $in: ['pending', 'accepted'] },
      }).select('task').lean();
      const taskIds = assignments.map((a) => a.task);
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
          taskContextStr = tasks
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
      console.warn('[DailyClose] Task context failed:', err.message);
    }
  }

  return {
    employeeName,
    employeeRole,
    employeeDesignation,
    employeeDepartment,
    employeeRecordId,
    kris: [...manualKRIs, ...aiKRIs].slice(0, 10),
    taskContextStr,
  };
}

/**
 * Analyze all pending screenshots for a user/day, merge with any existing
 * analysis, persist, then DELETE every screenshot for that day.
 */
export async function analyzeAndPurgeUserDay({ userId, dateString, models, databaseName }) {
  const { Screenshot, ScreenshotAnalysis } = models;

  const allScreenshots = await Screenshot.find({ user: userId, dateString })
    .sort({ capturedAt: 1 })
    .lean();

  if (allScreenshots.length === 0) {
    return { skipped: true, reason: 'no_screenshots' };
  }

  const pending = allScreenshots.filter((s) => !s.analyzed);
  const existing = await ScreenshotAnalysis.findOne({ user: userId, dateString }).lean();

  let merged = existing?.aiAnalysis || null;
  let analyzedCount = 0;

  if (pending.length > 0) {
    const ctx = await gatherEmployeeContext({ userId, models });
    try {
      const fresh = await analyzeScreenshotBatch({
        screenshots: pending,
        ScreenshotModel: Screenshot,
        databaseName,
        previousAnalysisSummary: merged?.summary || null,
        context: { ...ctx, dateString },
      });
      merged = mergeDailyAnalyses(merged, fresh, {
        previousCount: (existing?.analyzedScreenshotIds || []).length,
        freshCount: pending.length,
      });
      analyzedCount = pending.length;

      const allAnalyzedIds = [
        ...(existing?.analyzedScreenshotIds || []).map((id) => id.toString()),
        ...allScreenshots.map((s) => s._id.toString()),
      ];
      const dedupedIds = Array.from(new Set(allAnalyzedIds));

      await ScreenshotAnalysis.findOneAndUpdate(
        { user: userId, dateString },
        {
          $set: {
            user: userId,
            employee: ctx.employeeRecordId || existing?.employee || null,
            dateString,
            date: new Date(`${dateString}T00:00:00.000Z`),
            aiAnalysis: merged,
            analyzedScreenshotIds: dedupedIds,
            lastAnalyzedAt: new Date(),
            status: 'completed',
            summary: merged?.summary || null,
            metrics: {
              score: merged?.score ?? null,
              focusScore: merged?.focusScore ?? null,
              taskCompletionIndicators: merged?.taskCompletionIndicators ?? null,
              timeDistribution: merged?.timeDistribution || null,
            },
            provider: 'inference',
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } catch (err) {
      console.error(`[DailyClose] Analysis failed for user ${userId} on ${dateString}:`, err.message);
      return { skipped: true, reason: 'analysis_failed', error: err.message };
    }
  }

  // Now delete every screenshot for the day (DB + GridFS + filesystem)
  const gridfsIds = allScreenshots.map((s) => s.gridfsFileId).filter(Boolean);
  const fsPaths = allScreenshots.map((s) => s.path).filter(Boolean);
  const ids = allScreenshots.map((s) => s._id);

  let gridfsDeleted = 0;
  if (gridfsIds.length > 0) {
    try {
      const result = await deleteScreenshots(gridfsIds, { databaseName });
      gridfsDeleted = result?.deletedCount || gridfsIds.length;
    } catch (err) {
      console.warn('[DailyClose] GridFS delete error:', err.message);
    }
  }

  let fsDeleted = 0;
  for (const relPath of fsPaths) {
    try {
      await unlink(path.join(process.cwd(), 'public', relPath));
      fsDeleted += 1;
    } catch (_) { /* missing file is fine */ }
  }

  let dbDeleted = 0;
  try {
    const result = await Screenshot.deleteMany({ _id: { $in: ids } });
    dbDeleted = result?.deletedCount || 0;
  } catch (err) {
    console.warn('[DailyClose] DB delete error:', err.message);
  }

  return {
    skipped: false,
    analyzedCount,
    totalScreenshots: allScreenshots.length,
    dbDeleted,
    gridfsDeleted,
    fsDeleted,
  };
}
