import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import { enqueueAnalysis, getQueueStatus, getGlobalQueueStats } from '@/lib/productivityQueue';

/**
 * POST /api/productivity/sessions/analyze-queue
 * Enqueue un-analyzed sessions for background AI analysis
 * Can be triggered manually or on logout
 */
export async function POST(request) {
    try {
        const auth = await getAuthAndModels(request, ['ProductivitySession']);
        if (!auth.success) {
            return NextResponse.json({ success: false, message: auth.message }, { status: 401 });
        }

        const { user, models } = auth;
        const { ProductivitySession } = models;
        const userId = (user._id || user.userId).toString();
        const databaseName = auth.tenant?.databaseName || user.databaseName;

        // Optionally accept specific session IDs, or find all un-analyzed
        let body = {};
        try {
            body = await request.json();
        } catch {
            // No body — will find all un-analyzed sessions
        }

        let sessionIds = body.sessionIds || [];

        if (sessionIds.length === 0) {
            // Find all un-analyzed sessions for this user
            const targetUserId = body.userId || userId;

            // Permission check for analyzing other users' sessions
            if (targetUserId !== userId && !['admin', 'hr'].includes(user.role)) {
                return NextResponse.json(
                    { success: false, message: 'Permission denied' },
                    { status: 403 }
                );
            }

            const unanalyzed = await ProductivitySession.find({
                user: targetUserId,
                $or: [
                    { 'analysis.isAnalyzed': { $ne: true } },
                    { 'analysis.isAnalyzed': { $exists: false } },
                ],
                'screenshots.0': { $exists: true },
            })
                .select('_id')
                .lean();

            sessionIds = unanalyzed.map(s => s._id.toString());
        }

        if (sessionIds.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No sessions to analyze',
                enqueued: 0,
            });
        }

        const result = enqueueAnalysis({
            databaseName,
            userId,
            sessionIds,
        });

        return NextResponse.json({
            success: true,
            message: `Enqueued ${result.enqueued} sessions for analysis`,
            enqueued: result.enqueued,
            alreadyQueued: result.alreadyQueued,
            totalInQueue: sessionIds.length,
        });
    } catch (error) {
        console.error('Analyze queue error:', error);
        return NextResponse.json(
            { success: false, message: 'Failed to enqueue analysis', details: error.message },
            { status: 500 }
        );
    }
}

/**
 * GET /api/productivity/sessions/analyze-queue
 * Get queue status for the current user
 */
export async function GET(request) {
    try {
        const auth = await getAuthAndModels(request, []);
        if (!auth.success) {
            return NextResponse.json({ success: false, message: auth.message }, { status: 401 });
        }

        const { user } = auth;
        const userId = (user._id || user.userId).toString();
        const databaseName = auth.tenant?.databaseName || user.databaseName;

        const status = getQueueStatus(databaseName, userId);

        // Admin/HR can also see global stats
        let globalStats = null;
        if (['admin', 'hr'].includes(user.role)) {
            globalStats = getGlobalQueueStats();
        }

        return NextResponse.json({
            success: true,
            data: {
                ...status,
                globalStats,
            },
        });
    } catch (error) {
        console.error('Queue status error:', error);
        return NextResponse.json(
            { success: false, message: 'Failed to get queue status', details: error.message },
            { status: 500 }
        );
    }
}
