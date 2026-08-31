import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { connectSuperadminDB } from '@/lib/superadminDb';
import getTenantCompanyModel from '@/models/TenantCompany';
import { getTenantModels } from '@/lib/tenantModels';
import { cleanupOrphanedScreenshots, deleteOldScreenshots } from '@/lib/gridfs';
import { cleanupExpiredScreenshotsForTenant } from '@/lib/productivityScreenshotRetention';
import { getScreenshotRetentionCutoff } from '@/lib/productivitySessionRules';
import { getCronAuthErrorResponse } from '@/lib/cronAuth';

async function runCleanup(request) {
    try {
        const authError = getCronAuthErrorResponse(request);
        if (authError) return authError;

        await connectDB();
        await connectSuperadminDB();

        const TenantCompany = await getTenantCompanyModel();
        const companies = await TenantCompany.find({ isActive: true }).lean();

        const results = {
            success: true,
            tenantsProcessed: 0,
            screenshotsDeleted: 0,
            gridfsDeleted: 0,
            filesystemDeleted: 0,
            sessionsUpdated: 0,
            mosaicsDeleted: 0,
            legacySharedBucketDeleted: 0,
            legacySharedBucketOrphanChunksDeleted: 0,
            legacySharedBucketOrphanFilesDeleted: 0,
            tenants: {},
            errors: [],
        };

        const cutoff = getScreenshotRetentionCutoff();

        for (const company of companies) {
            try {
                const tenantModels = await getTenantModels(company.databaseName, ['Screenshot', 'ProductivitySession', 'ScreenshotComposite']);
                const tenantResult = await cleanupExpiredScreenshotsForTenant({
                    databaseName: company.databaseName,
                    models: tenantModels,
                    cutoff,
                });

                results.tenantsProcessed += 1;
                results.screenshotsDeleted += tenantResult.screenshotDocsDeleted;
                results.gridfsDeleted += tenantResult.gridfsDeleted;
                results.filesystemDeleted += tenantResult.filesystemDeleted;
                results.sessionsUpdated += tenantResult.sessionsUpdated;
                results.mosaicsDeleted += tenantResult.mosaicsDeleted || 0;
                results.tenants[company.slug || company.databaseName] = tenantResult;
            } catch (error) {
                console.error(`[ScreenshotRetentionCron] Tenant cleanup failed for ${company.databaseName}:`, error.message);
                results.errors.push({
                    tenant: company.slug || company.databaseName,
                    error: error.message,
                });
            }
        }

        try {
            const legacyResult = await deleteOldScreenshots(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
            results.legacySharedBucketDeleted = legacyResult?.deletedCount || 0;
            results.gridfsDeleted += results.legacySharedBucketDeleted;
        } catch (error) {
            console.error('[ScreenshotRetentionCron] Legacy shared bucket cleanup failed:', error.message);
            results.errors.push({ tenant: 'legacy-shared-bucket', error: error.message });
        }

        try {
            const legacyOrphanResult = await cleanupOrphanedScreenshots();
            results.legacySharedBucketOrphanChunksDeleted = legacyOrphanResult?.orphanChunksDeleted || 0;
            results.legacySharedBucketOrphanFilesDeleted = legacyOrphanResult?.orphanFilesDeleted || 0;
        } catch (error) {
            console.error('[ScreenshotRetentionCron] Legacy orphan cleanup failed:', error.message);
            results.errors.push({ tenant: 'legacy-shared-bucket-orphans', error: error.message });
        }

        return NextResponse.json(results);
    } catch (error) {
        console.error('[ScreenshotRetentionCron] Cleanup error:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Failed to cleanup expired screenshots' },
            { status: 500 }
        );
    }
}

export async function GET(request) {
    return runCleanup(request);
}

export async function POST(request) {
    return runCleanup(request);
}
