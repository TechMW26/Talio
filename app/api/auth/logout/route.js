import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import { enqueueAnalysis, getQueueStatus } from '@/lib/productivityQueue';

/**
 * POST /api/auth/logout
 * Server-side logout handler:
 * 1. Finds all un-analyzed productivity sessions for the user
 * 2. Enqueues them for background AI analysis
 * 3. Returns immediately (analysis happens in background)
 */
export async function POST(request) {
    try {
        // Auth + models - need ProductivitySession to find un-analyzed sessions
        const auth = await getAuthAndModels(request, ['ProductivitySession']);
        if (!auth.success) {
            // Even if auth fails, the client should still clear local state
            return NextResponse.json({ success: true, message: 'Logged out' });
        }

        const { user, models } = auth;
        const { ProductivitySession } = models;
        const userId = (user._id || user.userId).toString();
        const databaseName = auth.tenant?.databaseName || user.databaseName;

        // Find un-analyzed sessions for this user that still have screenshots
        let enqueuedCount = 0;
        try {
            const unanalyzedSessions = await ProductivitySession.find({
                user: userId,
                $or: [
                    { 'analysis.isAnalyzed': { $ne: true } },
                    { 'analysis.isAnalyzed': { $exists: false } },
                ],
                'screenshots.0': { $exists: true }, // Has at least one screenshot
            })
                .select('_id')
                .lean();

            if (unanalyzedSessions.length > 0) {
                const sessionIds = unanalyzedSessions.map(s => s._id.toString());

                console.log(`[Logout] User ${userId} has ${sessionIds.length} un-analyzed sessions. Enqueuing for background analysis...`);

                const result = enqueueAnalysis({
                    databaseName,
                    userId,
                    sessionIds,
                });

                enqueuedCount = result.enqueued;
                console.log(`[Logout] Enqueued ${enqueuedCount} sessions for analysis`);
            } else {
                console.log(`[Logout] User ${userId} has no un-analyzed sessions`);
            }
        } catch (queueError) {
            // Don't fail logout if queue enqueue fails
            console.error(`[Logout] Failed to enqueue analysis:`, queueError.message);
        }

        return NextResponse.json({
            success: true,
            message: 'Logged out successfully',
            productivity: {
                sessionsEnqueued: enqueuedCount,
                message: enqueuedCount > 0
                    ? `${enqueuedCount} productivity sessions queued for background analysis`
                    : 'No pending sessions to analyze',
            },
        });
    } catch (error) {
        console.error('Logout error:', error);
        // Always return success for logout - client should clear state regardless
        return NextResponse.json({ success: true, message: 'Logged out' });
    }
}
