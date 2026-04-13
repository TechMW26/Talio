import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import { importLinkedInProfile } from '@/lib/linkedinSync';

const ALLOWED_ROLES = ['admin', 'hr', 'manager'];

export async function POST(request) {
    try {
        const auth = await getAuthAndModels(request, ['Candidate', 'JobPosting', 'CompanySettings']);
        if (!auth.success) {
            return NextResponse.json({ success: false, message: auth.message }, { status: 401 });
        }

        const { user, tenant, models } = auth;
        if (!ALLOWED_ROLES.includes(user.role)) {
            return NextResponse.json(
                { success: false, message: 'Insufficient permissions to import LinkedIn profiles' },
                { status: 403 }
            );
        }

        const body = await request.json().catch(() => ({}));
        const profilePayload = body.profileData || body.applicant || body.candidate;
        if (!profilePayload || typeof profilePayload !== 'object') {
            return NextResponse.json(
                { success: false, message: 'profileData is required to import a LinkedIn profile' },
                { status: 400 }
            );
        }

        const actorId = user.employeeId?._id || user.employeeId || user._id;
        const result = await importLinkedInProfile(tenant.databaseName, {
            models,
            actorId,
            jobPosting: body.jobPosting || body.jobId || body.jobPostingId,
            profileData: profilePayload,
            syncSource: 'profile-import',
            applicationNote: body.applicationNote || 'Imported from LinkedIn profile',
            updateNote: body.updateNote || 'LinkedIn profile imported again',
            overrideCandidateFields: body.overrideCandidateFields,
        });

        const isDuplicate = result.status === 'cross-job-duplicate';

        return NextResponse.json(
            {
                success: !isDuplicate,
                message: isDuplicate
                    ? 'A candidate with this email already exists for another job posting'
                    : result.status === 'updated'
                        ? 'LinkedIn profile updated successfully'
                        : 'LinkedIn profile imported successfully',
                data: result,
            },
            { status: isDuplicate ? 409 : result.status === 'created' ? 201 : 200 }
        );
    } catch (error) {
        console.error('[LinkedIn Import] Profile import failed:', error);
        return NextResponse.json(
            { success: false, message: error.message || 'Failed to import LinkedIn profile' },
            { status: 500 }
        );
    }
}