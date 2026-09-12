/**
 * Productivity Analysis Queue
 * 
 * Durable queue that handles AI analysis of productivity sessions
 * with rate limiting protection and retry logic.
 * 
 * Features:
 * - Durable retry through Vercel Queues
 * - Per-session distributed lease and completion deduplication
 * - Real-time event emission on completion
 * - Automatic GridFS cleanup after successful analysis
 */

import { getTenantModels } from '@/lib/tenantModels';
import { generateVisionContent } from '@/lib/gemini';
import { deleteScreenshots as deleteGridFSScreenshots } from '@/lib/gridfs';
import { unlink, rmdir } from 'fs/promises';
import path from 'path';
import { parseProductivityAnalysisResponse } from '@/lib/productivityAnalysisResult';
import { formatDesignation, formatDepartments } from '@/lib/formatters';
import { loadScreenshotsForAnalysisBatch } from '@/lib/productivityScreenshotLoader';
import { buildDeletedScreenshotPlaceholders, buildSessionScreenshotLookupQuery } from '@/lib/productivitySessionRules';

import { enqueueBackgroundJob } from '@/lib/platform/backgroundJobs.server';

const MAX_IMAGES_PER_ANALYSIS = 10;

export async function enqueueAnalysis({ databaseName, userId, sessionIds }) {
    const ids = [...new Set((sessionIds || []).map(String))];
    for (const sessionId of ids) {
        await enqueueBackgroundJob('productivity-session', { databaseName, userId, sessionId }, {
            id: `${userId}:${sessionId}`,
        });
    }
    return { enqueued: ids.length, alreadyQueued: (sessionIds || []).length - ids.length };
}

export async function analyzeSession(entry) {
    const { sessionId, databaseName, userId } = entry;

    // Load models
    const models = await getTenantModels(databaseName, [
        'ProductivitySession', 'User', 'Task', 'TaskAssignee', 'Project', 'Screenshot', 'Employee', 'Department'
    ]);

    const { ProductivitySession, User, Task, TaskAssignee, Screenshot } = models;

    // Get session
    const session = await ProductivitySession.findById(sessionId);
    if (!session) {
        throw new Error(`Session ${sessionId} not found`);
    }
    if (String(session.user) !== String(userId)) throw new Error('Session owner does not match job');

    // Skip if already analyzed
    if (session.analysis?.isAnalyzed) {
        console.log(`[ProductivityQueue] Session ${sessionId} already analyzed, running cleanup only`);
        await cleanupSessionScreenshots(session, Screenshot, databaseName);
        return;
    }

    // Get user info for context
    let employeeName = 'Employee';
    let employeeDesignation = '';
    let employeeDepartment = '';
    let employeeId = null;
    let employeeManualKRIs = [];
    let employeeAiKRIs = [];

    const sessionUserId = session.user?.toString();
    if (sessionUserId) {
        const userRecord = await User.findById(sessionUserId).populate({
            path: 'employeeId',
            populate: [
                { path: 'designation', select: 'title level levelName' },
                { path: 'department', select: 'name' },
                { path: 'departments', select: 'name' }
            ]
        });
        if (userRecord?.employeeId) {
            employeeName = `${userRecord.employeeId.firstName} ${userRecord.employeeId.lastName}`;
            employeeDesignation = formatDesignation(userRecord.employeeId.designation, userRecord.employeeId) || userRecord.employeeId.jobTitle || '';
            employeeDepartment = formatDepartments(userRecord.employeeId) || '';
            employeeManualKRIs = Array.isArray(userRecord.employeeId.manualKRIs) ? userRecord.employeeId.manualKRIs.filter(Boolean) : [];
            employeeAiKRIs = Array.isArray(userRecord.employeeId.aiGeneratedKRIs)
                ? userRecord.employeeId.aiGeneratedKRIs.map((item) => item?.title).filter(Boolean)
                : [];
            employeeId = userRecord.employeeId._id;
        }
    }

    // Fetch ongoing tasks for context
    let taskContextStr = 'No active tasks assigned';
    if (employeeId) {
        try {
            const taskAssignments = await TaskAssignee.find({
                user: employeeId,
                assignmentStatus: { $in: ['pending', 'accepted'] }
            }).select('task').lean();

            const taskIds = taskAssignments.map(ta => ta.task);
            if (taskIds.length > 0) {
                const tasks = await Task.find({
                    _id: { $in: taskIds },
                    status: { $in: ['todo', 'in-progress', 'review'] }
                })
                    .populate('project', 'name')
                    .select('title status priority dueDate project tags')
                    .sort({ priority: -1, dueDate: 1 })
                    .limit(10)
                    .lean();

                if (tasks.length > 0) {
                    taskContextStr = tasks.map((task, idx) => {
                        const projectName = task.project?.name || 'No Project';
                        const dueDate = task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'No due date';
                        return `${idx + 1}. [${task.status.toUpperCase()}] "${task.title}" (Project: ${projectName}, Priority: ${task.priority}, Due: ${dueDate})`;
                    }).join('\n');
                }
            }
        } catch (err) {
            console.error(`[ProductivityQueue] Error fetching tasks:`, err.message);
        }
    }

    // Prepare images for analysis
    const screenshots = session.screenshots || [];
    if (screenshots.length === 0) {
        throw new Error('No screenshots in session');
    }

    const selectedIndices = selectEvenlyDistributed(screenshots.length, MAX_IMAGES_PER_ANALYSIS);
    const selectedScreenshots = selectedIndices.map(i => screenshots[i]);

    // Load images — prioritize GridFS, fall back to URL/filesystem
    const { loaded: loadedScreenshots, errors: screenshotLoadErrors } = await loadScreenshotsForAnalysisBatch(
        selectedScreenshots,
        { ScreenshotModel: Screenshot, databaseName }
    );

    for (const { screenshot, error } of screenshotLoadErrors) {
        console.error(`[ProductivityQueue] Failed to load image ${screenshot?.url || screenshot?.path}:`, error?.message || error);
    }

    const images = loadedScreenshots.map(({ image }) => image);

    if (images.length === 0) {
        throw new Error('Failed to load any screenshots for analysis');
    }

    // Build analysis prompt (condensed version - same scoring criteria as the main route)
    const sessionDurationMs = new Date(session.endTime) - new Date(session.startTime);
    const sessionDurationMinutes = Math.round(sessionDurationMs / (1000 * 60));

    const roleContextStr = employeeDesignation || employeeDepartment || 'Not specified';
    const kriContextStr = [...employeeManualKRIs, ...employeeAiKRIs].slice(0, 10).join('\n') || 'No explicit KRIs configured. Infer from designation and assigned tasks.';

    const analysisPrompt = buildAnalysisPrompt({
        employeeName,
        roleContextStr,
        kriContextStr,
        taskContextStr,
        sessionDate: session.date?.toISOString().split('T')[0] || 'Unknown',
        startTime: session.startTime?.toLocaleTimeString() || '',
        endTime: session.endTime?.toLocaleTimeString() || '',
        durationMinutes: sessionDurationMinutes,
        totalScreenshots: screenshots.length,
        analyzedCount: images.length,
    });

    // Call AI - this will throw on rate limit (caught by queue processor)
    const responseText = await generateVisionContent(analysisPrompt, images);

    if (!responseText || responseText.trim().length === 0) {
        throw new Error('Empty response from AI');
    }

    // Parse JSON response
    const analysisResult = parseAnalysisResponse(responseText);

    // Validate score
    if (typeof analysisResult.score !== 'number' || analysisResult.score < 0 || analysisResult.score > 100) {
        analysisResult.score = 60;
    }

    // Save analysis to session
    session.sessionTitle = analysisResult.sessionTitle || 'Work Session';
    session.analysis = {
        isAnalyzed: true,
        analyzedAt: new Date(),
        summary: analysisResult.summary || '',
        score: analysisResult.score,
        achievements: analysisResult.achievements || [],
        suggestions: analysisResult.suggestions || [],
        insights: analysisResult.insights || [],
        concerns: analysisResult.concerns || [],
        redFlags: analysisResult.redFlags || [],
        focusScore: analysisResult.focusScore || null,
        taskCompletionIndicators: analysisResult.taskCompletionIndicators || null,
        timeDistribution: analysisResult.timeDistribution || null,
        focusMetrics: analysisResult.focusMetrics || null,
        workCategories: analysisResult.workCategories || [],
        overallAssessment: analysisResult.overallAssessment || null,
        websites: (analysisResult.websites || []).map(site => ({
            domain: site.domain || 'Unknown',
            category: site.category || 'other',
            estimatedMinutes: site.estimatedMinutes || 0,
            wasActivelyViewed: site.wasActivelyViewed !== undefined ? site.wasActivelyViewed : true,
        })),
        applications: (analysisResult.applications || []).map(app => ({
            name: app.name || 'Unknown',
            category: app.category || 'other',
            estimatedMinutes: app.estimatedMinutes || 0,
            productivityImpact: app.productivityImpact || 'neutral',
            wasActivelyUsed: app.wasActivelyUsed !== undefined ? app.wasActivelyUsed : true,
        })),
        screenshotAnalysis: (analysisResult.screenshotAnalysis || []).map(sa => ({
            index: sa.index,
            summary: sa.summary || '',
            activity: sa.activity || '',
            productivity: sa.productivity || '',
            applicationVisible: sa.applicationVisible || '',
            websiteVisible: sa.websiteVisible || '',
            isActiveWork: sa.isActiveWork || false,
            concerns: sa.concerns || '',
            youtubeStatus: sa.youtubeStatus || 'not_applicable',
        })),
        taskRelativity: analysisResult.taskRelativity || null,
        error: null,
    };

    await session.save();

    // Cleanup screenshots (GridFS + DB)
    await cleanupSessionScreenshots(session, Screenshot, databaseName);

    console.log(`[ProductivityQueue] Session ${sessionId} - score: ${analysisResult.score}`);
}

// ─── GridFS Cleanup (the fix for storage bloat) ─────────────────────

async function cleanupSessionScreenshots(session, Screenshot, databaseName) {
    try {
        const screenshots = session.screenshots || [];
        if (screenshots.length === 0 || session.screenshotsDeleted) return;

        // Step 1: Query Screenshot DB records for full cleanup data
        const gridfsFileIds = [];
        const filesystemPaths = [];
        const screenshotQuery = buildSessionScreenshotLookupQuery(session);

        if (Screenshot) {
            const dbScreenshots = await Screenshot.find(screenshotQuery)
                .select('gridfsFileId path')
                .lean();

            for (const ss of dbScreenshots) {
                if (ss.gridfsFileId) gridfsFileIds.push(ss.gridfsFileId);
                if (ss.path && !ss.path.startsWith('http')) filesystemPaths.push(ss.path);
            }
        }

        // Step 2: Delete GridFS files
        if (gridfsFileIds.length > 0) {
            console.log(`[ProductivityQueue] Deleting ${gridfsFileIds.length} GridFS files...`);
            try {
                const gridfsResult = await deleteGridFSScreenshots(gridfsFileIds, { databaseName });
                console.log(`[ProductivityQueue] ✅ GridFS cleanup: ${gridfsResult.successCount}/${gridfsFileIds.length} deleted`);
            } catch (err) {
                console.error(`[ProductivityQueue] GridFS deletion failed:`, err.message);
            }
        }

        // Step 3: Delete local filesystem files
        if (filesystemPaths.length > 0) {
            console.log(`[ProductivityQueue] Deleting ${filesystemPaths.length} local filesystem files...`);
            let fsDeleteCount = 0;
            const parentDirs = new Set();
            for (const fsPath of filesystemPaths) {
                try {
                    const fullPath = path.join(process.cwd(), 'public', fsPath);
                    await unlink(fullPath);
                    fsDeleteCount++;
                    parentDirs.add(path.dirname(fullPath));
                } catch (err) {
                    // File may already be deleted or not exist — not critical
                    if (err.code !== 'ENOENT') {
                        console.warn(`[ProductivityQueue] Failed to delete file ${fsPath}:`, err.message);
                    }
                }
            }
            console.log(`[ProductivityQueue] ✅ Filesystem cleanup: ${fsDeleteCount}/${filesystemPaths.length} deleted`);

            // Try to clean up empty parent directories
            for (const dir of parentDirs) {
                try {
                    await rmdir(dir);
                    console.log(`[ProductivityQueue] Removed empty directory: ${dir}`);
                } catch {
                    // Directory not empty or doesn't exist — that's fine
                }
            }
        }

        // Step 4: Delete Screenshot DB records
        if (Screenshot) {
            const deleteResult = await Screenshot.deleteMany(screenshotQuery);
            console.log(`[ProductivityQueue] Deleted ${deleteResult.deletedCount} Screenshot DB records`);
        }

        // Step 5: Mark session as cleaned up
        const originalCount = session.screenshots?.length || 0;
        session.screenshots = buildDeletedScreenshotPlaceholders(session.screenshots);
        session.screenshotCount = originalCount;
        session.screenshotsDeleted = true;
        session.screenshotsDeletedAt = new Date();
        await session.save();

    } catch (err) {
        console.error(`[ProductivityQueue] Cleanup error (non-fatal):`, err.message);
    }
}

// ─── Emit real-time event for analysis completion ─────────────────────

function emitAnalysisComplete(entry) {
    try {
        if (global.io) {
            global.io.to(`user:${entry.userId}`).emit('productivity-analysis-complete', {
                sessionId: entry.sessionId,
                status: entry.status,
                timestamp: new Date().toISOString(),
            });
        }
    } catch {
        // Non-critical
    }
}

// ─── Analysis Prompt Builder ──────────────────────────────────────────

function buildAnalysisPrompt({ employeeName, roleContextStr, kriContextStr, taskContextStr, sessionDate, startTime, endTime, durationMinutes, totalScreenshots, analyzedCount }) {
    return `You are a workplace productivity analyst analyzing desktop screenshots with evidence-based scoring.

EMPLOYEE: ${employeeName} | Role: ${roleContextStr}
ROLE RESPONSIBILITIES (KRI CONTEXT):
${kriContextStr}

ASSIGNED TASKS:
${taskContextStr}

SESSION: ${sessionDate} | ${startTime} - ${endTime} | ${durationMinutes} min | ${totalScreenshots} screenshots (${analyzedCount} sampled)

SCORING: 85-100 exceptional, 70-84 productive, 55-69 moderate, 40-54 below avg, 25-39 poor, 0-24 unproductive.
RED FLAGS: entertainment-heavy browsing, repeated idle screens, non-work media playback during work blocks.
CALIBRATION RULES:
- Do not assign very low scores without clear repeated evidence of idle/distraction.
- Being on a work app is not automatically productive, but do not penalize purely due to lack of visible typing in screenshots.
- Use uncertainty-aware language when evidence is limited (${analyzedCount} sampled of ${totalScreenshots}).
- Keep score, focusScore, and taskCompletionIndicators logically consistent.
- Avoid extreme judgments when screenshots show mixed behavior.
- Treat role-specific research and ideation as productive when it aligns with KRIs (for example, a video editor reviewing YouTube references).

RESPOND WITH ONLY THIS JSON (no markdown):
{
  "sessionTitle": "<2-4 word session name>",
    "summary": "2 short paragraph analysis, max 140 words total",
  "score": <0-100>,
  "focusScore": <0-100>,
  "taskCompletionIndicators": <0-100>,
  "timeDistribution": { "deepWork": <pct>, "collaboration": <pct>, "administrative": <pct>, "unfocused": <pct>, "idle": <pct> },
  "focusMetrics": { "longestFocusStreak": "<duration>", "contextSwitches": <num>, "distractionCount": <num>, "idleScreensDetected": <num> },
  "achievements": ["..."],
  "suggestions": ["..."],
  "insights": ["..."],
  "concerns": ["..."],
  "redFlags": ["..."],
  "workCategories": [{ "category": "...", "percentage": <num>, "isActive": <bool> }],
  "screenshotAnalysis": [{ "index": <num>, "summary": "...", "activity": "...", "productivity": "high|medium|low|idle", "applicationVisible": "...", "websiteVisible": "...", "isActiveWork": <bool>, "concerns": "...", "youtubeStatus": "playing|paused|not_applicable" }],
  "applications": [{ "name": "...", "category": "...", "estimatedMinutes": <num>, "productivityImpact": "positive|neutral|negative", "wasActivelyUsed": <bool> }],
  "websites": [{ "domain": "...", "category": "...", "estimatedMinutes": <num>, "wasActivelyViewed": <bool> }],
  "taskRelativity": { "score": <0-100>, "matchedTasks": ["..."], "unrelatedActivities": ["..."], "assessment": "..." },
    "overallAssessment": { "genuineWorkPercentage": <num>, "taskAlignmentPercentage": <num>, "strengths": ["..."], "majorConcerns": ["..."], "areasForImprovement": ["..."], "recommendation": "..." }
}

OUTPUT RULES:
- Do not omit keys. Use [] or null when unknown.
- Keep achievements, suggestions, insights, concerns, and redFlags to the 3-4 most important items.
- Keep workCategories, applications, and websites to the 5 most relevant items.
- Include one concise screenshotAnalysis item per analyzed screenshot.`;
}

// ─── JSON Response Parser ─────────────────────────────────────────────

function parseAnalysisResponse(responseText) {
    return parseProductivityAnalysisResponse(responseText);
}

// ─── Helpers ──────────────────────────────────────────────────────────

function selectEvenlyDistributed(totalCount, maxSelect) {
    if (totalCount <= maxSelect) {
        return Array.from({ length: totalCount }, (_, i) => i);
    }
    const indices = [];
    const step = (totalCount - 1) / (maxSelect - 1);
    for (let i = 0; i < maxSelect; i++) {
        indices.push(Math.round(i * step));
    }
    return indices;
}
