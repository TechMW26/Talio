import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import { syncLinkedInApplicants } from '@/lib/linkedinSync';

const ALLOWED_ROLES = ['admin', 'hr'];

export async function POST(request) {
    try {
        const auth = await getAuthAndModels(request, ['Candidate', 'JobPosting', 'CompanySettings']);
        if (!auth.success) {
            return NextResponse.json({ success: false, message: auth.message }, { status: 401 });
        }

        const { user, tenant, models } = auth;
        if (!ALLOWED_ROLES.includes(user.role)) {
            return NextResponse.json(
                { success: false, message: 'Only admin and HR can run LinkedIn sync' },
                { status: 403 }
            );
        }

        const body = await request.json().catch(() => ({}));
        const actorId = user.employeeId?._id || user.employeeId || user._id;
        const summary = await syncLinkedInApplicants(tenant.databaseName, {
            models,
            actorId,
            jobId: body.jobId,
            jobIds: body.jobIds,
            since: body.since,
            limit: body.limit,
            applicants: body.applicants,
            applicantsByJob: body.applicantsByJob,
            applicantsEndpointTemplate: body.applicantsEndpointTemplate,
            syncSource: 'manual-sync',
            applicationNote: body.applicationNote || 'Imported from LinkedIn sync',
            updateNote: body.updateNote || 'LinkedIn candidate refreshed by manual sync',
        });

        return NextResponse.json({
            success: true,
            message: 'LinkedIn sync completed',
            data: summary,
        });
    } catch (error) {
        console.error('[LinkedIn Sync] Manual sync failed:', error);
        return NextResponse.json(
            { success: false, message: error.message || 'Failed to sync LinkedIn applicants' },
            { status: 500 }
        );
    }
}