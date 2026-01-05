import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import { getTenantModels } from '@/lib/tenantModels';
import { bulkDeleteFromImageKit } from '@/lib/imagekit';

/**
 * POST /api/productivity/sessions/cleanup
 * Clean up screenshots from sessions that have been analyzed but screenshots not deleted
 * This is for fixing sessions that were analyzed before the cleanup logic was added
 */
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['ProductivitySession'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    
    const { user, models } = auth
    const { ProductivitySession } = models
    
    // Only allow admin/hr to run batch cleanup
    if (!['admin', 'hr'].includes(user.role)) {
      return NextResponse.json(
        { success: false, error: 'Only admin/hr can run batch cleanup' },
        { status: 403 }
      );
    }
    
    // Find all sessions that are analyzed but screenshots not deleted
    const sessionsToClean = await ProductivitySession.find({
      'analysis.isAnalyzed': true,
      $or: [
        { screenshotsDeleted: { $ne: true } },
        { screenshotsDeleted: { $exists: false } }
      ],
      'screenshots.0': { $exists: true } // Has at least one screenshot
    });
    
    console.log(`[SessionCleanup] Found ${sessionsToClean.length} sessions to clean up`);
    
    if (sessionsToClean.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No sessions need cleanup',
        cleaned: 0
      });
    }
    
    // Get Screenshot model for cleanup
    const { Screenshot } = await getTenantModels(auth.tenant.databaseName, ['Screenshot']);
    
    let cleanedCount = 0;
    let totalImagesDeleted = 0;
    let totalRawCapturesDeleted = 0;
    const errors = [];
    
    for (const session of sessionsToClean) {
      try {
        console.log(`[SessionCleanup] Cleaning session ${session._id}...`);
        
        // Collect ImageKit file IDs
        const imagekitFileIds = [];
        const screenshots = session.screenshots || [];
        
        for (const screenshot of screenshots) {
          if (screenshot.fileId) {
            imagekitFileIds.push(screenshot.fileId);
          }
          if (screenshot.imagekitFileId) {
            imagekitFileIds.push(screenshot.imagekitFileId);
          }
        }
        
        // Delete from ImageKit
        if (imagekitFileIds.length > 0) {
          try {
            await bulkDeleteFromImageKit(imagekitFileIds);
            totalImagesDeleted += imagekitFileIds.length;
            console.log(`[SessionCleanup] Deleted ${imagekitFileIds.length} images from ImageKit for session ${session._id}`);
          } catch (imagekitError) {
            console.error(`[SessionCleanup] ImageKit deletion failed for session ${session._id}:`, imagekitError.message);
          }
        }
        
        // Delete raw captures from Screenshot collection
        const deleteQuery = {};
        
        if (session.user) {
          deleteQuery.user = session.user;
        } else if (session.employee) {
          deleteQuery.employee = session.employee;
        }
        
        if (session.startTime && session.endTime) {
          deleteQuery.capturedAt = { $gte: session.startTime, $lte: session.endTime };
        }
        
        if (imagekitFileIds.length > 0) {
          deleteQuery.$or = [
            { imagekitFileId: { $in: imagekitFileIds } },
            ...(session.startTime && session.endTime ? [{ capturedAt: { $gte: session.startTime, $lte: session.endTime } }] : [])
          ];
          delete deleteQuery.capturedAt;
        }
        
        if (Object.keys(deleteQuery).length > 0) {
          const deleteResult = await Screenshot.deleteMany(deleteQuery);
          totalRawCapturesDeleted += deleteResult.deletedCount;
          console.log(`[SessionCleanup] Deleted ${deleteResult.deletedCount} raw captures for session ${session._id}`);
        }
        
        // Update session
        const originalScreenshotCount = session.screenshots?.length || 0;
        session.screenshots = session.screenshots.map((s, index) => ({
          deletedAt: new Date(),
          originalUrl: s.url || s.path,
          capturedAt: s.capturedAt || s.timestamp,
          index: index
        }));
        session.screenshotCount = originalScreenshotCount;
        session.screenshotsDeleted = true;
        session.screenshotsDeletedAt = new Date();
        await session.save();
        
        cleanedCount++;
        console.log(`[SessionCleanup] Session ${session._id} cleaned successfully`);
        
      } catch (sessionError) {
        console.error(`[SessionCleanup] Error cleaning session ${session._id}:`, sessionError.message);
        errors.push({ sessionId: session._id.toString(), error: sessionError.message });
      }
    }
    
    console.log(`[SessionCleanup] Cleanup complete. Cleaned ${cleanedCount}/${sessionsToClean.length} sessions`);
    
    return NextResponse.json({
      success: true,
      message: `Cleaned ${cleanedCount} sessions`,
      cleaned: cleanedCount,
      totalFound: sessionsToClean.length,
      imagesDeleted: totalImagesDeleted,
      rawCapturesDeleted: totalRawCapturesDeleted,
      errors: errors.length > 0 ? errors : undefined
    });
    
  } catch (error) {
    console.error('Session cleanup error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to cleanup sessions', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/productivity/sessions/cleanup
 * Check how many sessions need cleanup
 */
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['ProductivitySession'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    
    const { models } = auth
    const { ProductivitySession } = models
    
    // Count sessions that need cleanup
    const count = await ProductivitySession.countDocuments({
      'analysis.isAnalyzed': true,
      $or: [
        { screenshotsDeleted: { $ne: true } },
        { screenshotsDeleted: { $exists: false } }
      ],
      'screenshots.0': { $exists: true }
    });
    
    return NextResponse.json({
      success: true,
      sessionsNeedingCleanup: count
    });
    
  } catch (error) {
    console.error('Session cleanup check error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to check sessions', details: error.message },
      { status: 500 }
    );
  }
}
