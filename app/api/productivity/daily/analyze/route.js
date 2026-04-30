import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import mongoose from 'mongoose';
import { canViewUserScreenshots } from '@/lib/productivityPermissions';
import { formatDesignation, formatDepartments } from '@/lib/formatters';
import { analyzeScreenshotBatch, mergeDailyAnalyses } from '@/lib/dailyProductivityAnalyzer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * POST /api/productivity/daily/analyze
 * Body: { date: 'YYYY-MM-DD', userId?: string }
 *
 * Analyzes pending (analyzed=false) screenshots for the user/day, persists
 * the result on a single ScreenshotAnalysis doc keyed by {user, dateString},
 * marks those screenshots as analyzed, and returns the merged analysis.
 */
export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request, [
      'User',
      'Employee',
      'Department',
      'Screenshot',
      'ScreenshotAnalysis',
      'Task',
      'TaskAssignee',
      'Project',
    ]);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }

    const { user, models, tenant } = auth;
    const { User, Employee, Screenshot, ScreenshotAnalysis, Task, TaskAssignee } = models;

    const viewerId = user._id || user.userId;
    const viewerRole = user.role;
    if (!viewerId) {
      return NextResponse.json({ success: false, error: 'User ID not found' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const date = body.date || new Date().toISOString().split('T')[0];
    const targetUserId = (body.userId || viewerId).toString();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ success: false, error: 'Invalid date (expected YYYY-MM-DD)' }, { status: 400 });
    }

    if (targetUserId !== viewerId.toString() && !mongoose.Types.ObjectId.isValid(targetUserId)) {
      return NextResponse.json({ success: false, error: 'Invalid userId' }, { status: 400 });
    }

    const canView = await canViewUserScreenshots(viewerId, targetUserId, viewerRole, models);
    if (!canView) {
      return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
    }

    // Pending screenshots for the day
    const pendingScreenshots = await Screenshot.find({
      user: targetUserId,
      dateString: date,
      analyzed: { $ne: true },
    })
      .sort({ capturedAt: 1 })
      .select('_id user employee capturedAt path imagekitUrl gridfsFileId metadata.mimeType')
      .lean();

    // Existing analysis (if any) — needed to merge or to short-circuit
    const existingAnalysis = await ScreenshotAnalysis.findOne({
      user: targetUserId,
      dateString: date,
    }).lean();

    if (pendingScreenshots.length === 0) {
      return NextResponse.json({
        success: true,
        message: existingAnalysis
          ? 'No new screenshots to analyze; returning existing analysis.'
          : 'No screenshots captured yet for the requested day.',
        analysis: existingAnalysis
          ? {
              id: existingAnalysis._id.toString(),
              updatedAt: existingAnalysis.updatedAt || existingAnalysis.lastAnalyzedAt || null,
              lastAnalyzedAt: existingAnalysis.lastAnalyzedAt || null,
              analyzedScreenshotIds: (existingAnalysis.analyzedScreenshotIds || []).map((id) => id.toString()),
              aiAnalysis: existingAnalysis.aiAnalysis || null,
            }
          : null,
        pendingCount: 0,
      });
    }

    // Build employee context (designation, KRIs, department)
    let employeeName = 'Employee';
    let employeeRole = 'employee';
    let employeeDesignation = '';
    let employeeDepartment = '';
    let employeeManualKRIs = [];
    let employeeAiKRIs = [];
    let employeeRecordId = null;

    const userRecord = await User.findById(targetUserId).populate({
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
        employeeManualKRIs = Array.isArray(emp.manualKRIs) ? emp.manualKRIs.filter(Boolean) : [];
        employeeAiKRIs = Array.isArray(emp.aiGeneratedKRIs)
          ? emp.aiGeneratedKRIs.map((item) => item?.title).filter(Boolean)
          : [];
        employeeRecordId = emp._id;
      } else {
        employeeName = userRecord.name || 'Employee';
      }
    }

    // Active assigned tasks
    let taskContextStr = 'No active tasks assigned';
    if (employeeRecordId) {
      try {
        const taskAssignments = await TaskAssignee.find({
          user: employeeRecordId,
          assignmentStatus: { $in: ['pending', 'accepted'] },
        }).select('task').lean();

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
        console.warn('[Productivity/Daily/Analyze] Failed to load tasks:', err.message);
      }
    }

    const kris = [...employeeManualKRIs, ...employeeAiKRIs].slice(0, 10);

    let freshAnalysis;
    try {
      freshAnalysis = await analyzeScreenshotBatch({
        screenshots: pendingScreenshots,
        ScreenshotModel: Screenshot,
        databaseName: tenant.databaseName,
        previousAnalysisSummary: existingAnalysis?.aiAnalysis?.summary || null,
        context: {
          employeeName,
          employeeDesignation,
          employeeDepartment,
          employeeRole,
          kris,
          taskContextStr,
          dateString: date,
        },
      });
    } catch (err) {
      console.error('[Productivity/Daily/Analyze] Analysis failed:', err);
      return NextResponse.json(
        { success: false, error: err.message || 'AI analysis failed' },
        { status: 502 }
      );
    }

    const previousAnalyzedCount = (existingAnalysis?.analyzedScreenshotIds || []).length;
    const merged = mergeDailyAnalyses(existingAnalysis?.aiAnalysis || null, freshAnalysis, {
      previousCount: previousAnalyzedCount,
      freshCount: pendingScreenshots.length,
    });

    const allAnalyzedIds = [
      ...(existingAnalysis?.analyzedScreenshotIds || []).map((id) => id.toString()),
      ...pendingScreenshots.map((s) => s._id.toString()),
    ];
    // De-dup
    const dedupedIds = Array.from(new Set(allAnalyzedIds));

    const now = new Date();
    const update = {
      user: targetUserId,
      employee: employeeRecordId || existingAnalysis?.employee || null,
      dateString: date,
      date: new Date(`${date}T00:00:00.000Z`),
      aiAnalysis: merged,
      analyzedScreenshotIds: dedupedIds,
      lastAnalyzedAt: now,
      status: 'completed',
      summary: merged?.summary || null,
      metrics: {
        score: merged?.score ?? null,
        focusScore: merged?.focusScore ?? null,
        taskCompletionIndicators: merged?.taskCompletionIndicators ?? null,
        timeDistribution: merged?.timeDistribution || null,
      },
      provider: 'inference',
    };

    const saved = await ScreenshotAnalysis.findOneAndUpdate(
      { user: targetUserId, dateString: date },
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Mark analyzed
    await Screenshot.updateMany(
      { _id: { $in: pendingScreenshots.map((s) => s._id) } },
      { $set: { analyzed: true, analyzedAt: now } }
    );

    return NextResponse.json({
      success: true,
      message: existingAnalysis
        ? `Analyzed ${pendingScreenshots.length} new screenshot(s) and merged with existing analysis.`
        : `Analyzed ${pendingScreenshots.length} screenshot(s).`,
      analyzedCount: pendingScreenshots.length,
      analysis: {
        id: saved._id.toString(),
        updatedAt: saved.updatedAt || now,
        lastAnalyzedAt: now,
        analyzedScreenshotIds: dedupedIds,
        aiAnalysis: merged,
      },
    });
  } catch (error) {
    console.error('[Productivity/Daily/Analyze] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to analyze screenshots' },
      { status: 500 }
    );
  }
}
