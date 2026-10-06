import { NextResponse } from 'next/server';
import { getFirestoreSystemDatabase } from '@/lib/platform/firestoreApplication.server';
import { cleanupExpiredScreenshotsForTenant } from '@/lib/productivityScreenshotRetention';
import { getScreenshotRetentionCutoff } from '@/lib/productivitySessionRules';
import { getCronAuthErrorResponse } from '@/lib/cronAuth';

async function runCleanup(request) {
    try {
        const authError = getCronAuthErrorResponse(request);
        if (authError) return authError;

        const system = await getFirestoreSystemDatabase({ queryFields: { tenantcompanies: ['isActive'] } });
        const companies = [];
        let cursor;
        do {
            const page = await system.list('tenantcompanies', { filters: [{ field: 'isActive', operator: '==', value: true }], limit: 100, cursor });
            companies.push(...page.records); cursor = page.nextCursor;
        } while (cursor);

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
                const tenantResult = await cleanupExpiredScreenshotsForTenant({
                    databaseName: company.databaseName,
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

        // The preserved shared source is read-only. Retention applies solely to
        // each registered tenant's application media, never migration backups.

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
