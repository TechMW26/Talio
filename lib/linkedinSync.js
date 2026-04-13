import crypto from 'crypto';
import { decryptSecret } from '@/lib/secretEncryption';
import { upsertCandidate } from '@/lib/recruitmentHelpers';
import { getTenantModels } from '@/lib/tenantModels';
import { clearCachePattern, buildCachePattern } from '@/lib/cache';

const DEFAULT_LINKEDIN_APPLICANTS_URL = process.env.LINKEDIN_APPLICANTS_API_URL || '';

function normalizeArray(value) {
    if (Array.isArray(value)) {
        return value.filter(Boolean);
    }

    if (typeof value === 'string') {
        return value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    }

    return [];
}

function uniqueStrings(values) {
    return Array.from(new Set(normalizeArray(values).map((value) => value.trim()).filter(Boolean)));
}

function safeTrim(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function safeLower(value) {
    return safeTrim(value).toLowerCase();
}

function pickFirstString(...values) {
    for (const value of values) {
        const trimmed = safeTrim(value);
        if (trimmed) {
            return trimmed;
        }
    }

    return '';
}

function pickFirstNumber(...values) {
    for (const value of values) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }

        if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
            return Number(value);
        }
    }

    return undefined;
}

function parseNameParts(applicant = {}) {
    const firstName = pickFirstString(
        applicant.firstName,
        applicant.givenName,
        applicant.profile?.firstName,
        applicant.profile?.givenName
    );
    const lastName = pickFirstString(
        applicant.lastName,
        applicant.familyName,
        applicant.profile?.lastName,
        applicant.profile?.familyName
    );

    if (firstName || lastName) {
        return { firstName, lastName };
    }

    const fullName = pickFirstString(applicant.fullName, applicant.name, applicant.profile?.name);
    if (!fullName) {
        return { firstName: '', lastName: '' };
    }

    const [first, ...rest] = fullName.split(/\s+/);

    return {
        firstName: first || '',
        lastName: rest.join(' '),
    };
}

function normalizeResumeData(applicant = {}) {
    const resumeUrl = pickFirstString(
        applicant.resume?.url,
        applicant.resumeUrl,
        applicant.attachments?.resumeUrl,
        applicant.documents?.resumeUrl
    );
    const resumeName = pickFirstString(
        applicant.resume?.name,
        applicant.resumeName,
        applicant.attachments?.resumeName,
        applicant.documents?.resumeName,
        resumeUrl ? 'LinkedIn Resume' : ''
    );

    if (!resumeUrl) {
        return undefined;
    }

    return {
        name: resumeName,
        url: resumeUrl,
        uploadedAt: new Date(),
    };
}

function buildApplicantExternalIds(applicant = {}, job = {}) {
    return {
        applicantId: pickFirstString(applicant.id, applicant.applicantId, applicant.applicationId),
        profileId: pickFirstString(applicant.profileId, applicant.personId, applicant.linkedinProfileId),
        publicIdentifier: pickFirstString(
            applicant.publicIdentifier,
            applicant.linkedinPublicIdentifier,
            applicant.profile?.publicIdentifier
        ),
        jobPostingId: pickFirstString(
            applicant.linkedinJobPostingId,
            applicant.jobPostingId,
            applicant.jobId,
            job.linkedinJobPostingId
        ),
    };
}

function normalizeSourceMetadata(applicant = {}, job = {}, syncSource) {
    const externalIds = buildApplicantExternalIds(applicant, job);

    return {
        provider: 'linkedin',
        syncSource,
        applicantId: externalIds.applicantId || null,
        profileId: externalIds.profileId || null,
        publicIdentifier: externalIds.publicIdentifier || null,
        linkedinJobPostingId: externalIds.jobPostingId || null,
        receivedAt: new Date().toISOString(),
        raw: applicant,
    };
}

function normalizeLinkedInCandidateData({ applicant = {}, job, actorId, syncSource = 'manual-sync', override = {} }) {
    const { firstName, lastName } = parseNameParts(applicant);
    const email = safeLower(
        applicant.email || applicant.emailAddress || applicant.profile?.email || applicant.contact?.email
    );

    const profileUrl = pickFirstString(
        applicant.linkedinProfileUrl,
        applicant.profileUrl,
        applicant.publicProfileUrl,
        applicant.profile?.url
    );
    const publicIdentifier = pickFirstString(
        applicant.linkedinPublicIdentifier,
        applicant.publicIdentifier,
        applicant.profile?.publicIdentifier
    );
    const headline = pickFirstString(applicant.headline, applicant.profile?.headline);
    const currentCompany = pickFirstString(
        applicant.currentCompany,
        applicant.company,
        applicant.profile?.currentCompany,
        applicant.position?.companyName
    );
    const currentPosition = pickFirstString(
        applicant.currentPosition,
        applicant.title,
        applicant.profile?.currentPosition,
        applicant.position?.title
    );
    const totalExperience = pickFirstNumber(
        applicant.totalExperience,
        applicant.experienceYears,
        applicant.profile?.experienceYears
    );
    const phone = pickFirstString(
        applicant.phone,
        applicant.phoneNumber,
        applicant.contact?.phone,
        applicant.profile?.phone
    );
    const coverLetter = pickFirstString(applicant.coverLetter, applicant.message, applicant.notes);
    const sourceUrl = pickFirstString(applicant.sourceUrl, applicant.applicationUrl, profileUrl, job.linkedinPostingUrl);
    const tags = uniqueStrings(['linkedin', ...(applicant.tags || [])]);
    const skills = uniqueStrings(applicant.skills || applicant.profile?.skills || applicant.linkedinSkills);
    const education = Array.isArray(applicant.education) ? applicant.education : [];

    return {
        firstName,
        lastName,
        email,
        phone,
        jobPosting: job._id,
        resume: normalizeResumeData(applicant),
        coverLetter: coverLetter || undefined,
        currentCompany,
        currentDesignation: currentPosition,
        totalExperience,
        skills,
        education,
        source: 'linkedin',
        sourceUrl,
        sourceMetadata: normalizeSourceMetadata(applicant, job, syncSource),
        linkedinProfileUrl: profileUrl || undefined,
        linkedinPublicIdentifier: publicIdentifier || undefined,
        linkedinHeadline: headline || undefined,
        linkedinCurrentCompany: currentCompany || undefined,
        linkedinCurrentPosition: currentPosition || undefined,
        linkedinSkills: skills,
        linkedinImportedAt: new Date(),
        createdBy: actorId,
        tags,
        ...override,
    };
}

function buildApplicantsEndpoint(template, { job, since, limit }) {
    if (!template) {
        return null;
    }

    const endpoint = template
        .replaceAll('{jobPostingId}', encodeURIComponent(job.linkedinJobPostingId || ''))
        .replaceAll('{jobId}', encodeURIComponent(job._id?.toString?.() || ''))
        .replaceAll('{since}', encodeURIComponent(since || ''))
        .replaceAll('{limit}', encodeURIComponent(String(limit || '')));

    return endpoint;
}

function parseApplicantsResponse(payload) {
    if (Array.isArray(payload)) {
        return payload;
    }

    if (Array.isArray(payload?.data)) {
        return payload.data;
    }

    if (Array.isArray(payload?.elements)) {
        return payload.elements;
    }

    if (Array.isArray(payload?.items)) {
        return payload.items;
    }

    if (Array.isArray(payload?.applicants)) {
        return payload.applicants;
    }

    return [];
}

async function fetchApplicantsForJob({ accessToken, applicantsEndpointTemplate, job, since, limit = 100 }) {
    const endpoint = buildApplicantsEndpoint(applicantsEndpointTemplate, { job, since, limit });

    if (!endpoint) {
        throw new Error('LINKEDIN_APPLICANTS_API_URL is not configured and no applicants payload was provided');
    }

    const response = await fetch(endpoint, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'X-Restli-Protocol-Version': '2.0.0',
            Accept: 'application/json',
        },
        cache: 'no-store',
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LinkedIn applicant sync failed for job ${job.jobTitle}: ${errorText}`);
    }

    const payload = await response.json();
    return parseApplicantsResponse(payload);
}

async function findExistingCandidateByLinkedInIdentity(Candidate, jobId, candidateData) {
    const linkedinPublicIdentifier = candidateData.linkedinPublicIdentifier;
    const applicantId = candidateData.sourceMetadata?.applicantId;

    const queries = [];

    if (candidateData.email) {
        queries.push({ email: candidateData.email, jobPosting: jobId });
    }

    if (linkedinPublicIdentifier) {
        queries.push({ linkedinPublicIdentifier, jobPosting: jobId });
    }

    if (applicantId) {
        queries.push({ 'sourceMetadata.applicantId': applicantId, jobPosting: jobId });
    }

    for (const query of queries) {
        const existing = await Candidate.findOne(query);
        if (existing) {
            return existing;
        }
    }

    return null;
}

function mergeArrayValues(currentValues, nextValues) {
    return uniqueStrings([...(currentValues || []), ...(nextValues || [])]);
}

function buildCandidateUpdate(existingCandidate, candidateData, actorId, updateNote) {
    const nextUpdate = {
        firstName: candidateData.firstName || existingCandidate.firstName,
        lastName: candidateData.lastName || existingCandidate.lastName,
        phone: candidateData.phone || existingCandidate.phone,
        currentCompany: candidateData.currentCompany || existingCandidate.currentCompany,
        currentDesignation: candidateData.currentDesignation || existingCandidate.currentDesignation,
        totalExperience: candidateData.totalExperience ?? existingCandidate.totalExperience,
        coverLetter: candidateData.coverLetter || existingCandidate.coverLetter,
        source: 'linkedin',
        sourceUrl: candidateData.sourceUrl || existingCandidate.sourceUrl,
        sourceMetadata: {
            ...(existingCandidate.sourceMetadata?.toObject?.() || existingCandidate.sourceMetadata || {}),
            ...(candidateData.sourceMetadata || {}),
            lastSyncedAt: new Date().toISOString(),
        },
        linkedinProfileUrl: candidateData.linkedinProfileUrl || existingCandidate.linkedinProfileUrl,
        linkedinPublicIdentifier: candidateData.linkedinPublicIdentifier || existingCandidate.linkedinPublicIdentifier,
        linkedinHeadline: candidateData.linkedinHeadline || existingCandidate.linkedinHeadline,
        linkedinCurrentCompany: candidateData.linkedinCurrentCompany || existingCandidate.linkedinCurrentCompany,
        linkedinCurrentPosition: candidateData.linkedinCurrentPosition || existingCandidate.linkedinCurrentPosition,
        linkedinSkills: mergeArrayValues(existingCandidate.linkedinSkills, candidateData.linkedinSkills),
        linkedinImportedAt: new Date(),
        skills: mergeArrayValues(existingCandidate.skills, candidateData.skills),
        tags: mergeArrayValues(existingCandidate.tags, candidateData.tags),
    };

    if (candidateData.resume?.url) {
        nextUpdate.resume = candidateData.resume;
    }

    const notes = [...(existingCandidate.notes || [])];
    if (updateNote) {
        notes.push({
            note: updateNote,
            addedBy: actorId,
            addedAt: new Date(),
        });
        nextUpdate.notes = notes;
    }

    return nextUpdate;
}

function validateLinkedInCandidatePayload(candidateData) {
    if (!candidateData.firstName) {
        throw new Error('LinkedIn applicant is missing firstName');
    }

    if (!candidateData.lastName) {
        throw new Error('LinkedIn applicant is missing lastName');
    }

    if (!candidateData.email) {
        throw new Error('LinkedIn applicant is missing email');
    }
}

async function getIntegrationContext(tenantDb, options = {}) {
    const models = options.models || (await getTenantModels(tenantDb, ['Candidate', 'JobPosting', 'CompanySettings']));
    const settings = options.settings || (await models.CompanySettings.findOne());
    const linkedinSettings = settings?.integrations?.linkedin?.toObject?.() || settings?.integrations?.linkedin || {};
    const encryptedToken = linkedinSettings.accessToken || null;
    const accessToken = encryptedToken ? decryptSecret(encryptedToken) : null;

    return {
        models,
        settings,
        linkedinSettings,
        accessToken,
    };
}

async function resolveJobs(JobPosting, options = {}) {
    const jobIds = uniqueStrings(options.jobIds || []);
    const directJobId = safeTrim(options.jobId);
    const query = {};

    if (directJobId) {
        query._id = directJobId;
    } else if (jobIds.length) {
        query._id = { $in: jobIds };
    }

    if (!query._id) {
        query.status = { $in: ['open', 'draft'] };
        query.linkedinJobPostingId = { $exists: true, $ne: '' };
    }

    return JobPosting.find(query);
}

async function markLinkedInSync(settings, tenantDb, extraFields = {}) {
    if (!settings) {
        return;
    }

    const existingIntegrations = settings.integrations?.toObject?.() || settings.integrations || {};
    settings.integrations = {
        ...existingIntegrations,
        linkedin: {
            ...(existingIntegrations.linkedin || {}),
            ...extraFields,
            lastSyncAt: extraFields.lastSyncAt || new Date(),
        },
    };
    settings.markModified('integrations');
    await settings.save();

    const cachePattern = buildCachePattern({
        tenantId: tenantDb,
        role: 'shared',
        namespace: 'settings:company',
    });
    await clearCachePattern(cachePattern).catch(() => { });
}

export function resolveLinkedInTenantDatabaseName(value = {}) {
    const databaseName = safeTrim(value.databaseName || value.tenantDatabaseName || value.tenant);
    if (databaseName) {
        return databaseName;
    }

    const companySlug = safeTrim(value.companySlug || value.slug);
    if (companySlug) {
        return `talio_company_${companySlug}`;
    }

    throw new Error('LinkedIn tenant context is required');
}

export function verifyLinkedInWebhookSignature(rawBody, signature, secret) {
    if (!secret) {
        return false;
    }

    if (!signature) {
        return false;
    }

    const normalizedSignature = signature.includes('=') ? signature.split('=').pop() : signature;
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    if (normalizedSignature.length !== expected.length) {
        return false;
    }

    return crypto.timingSafeEqual(Buffer.from(normalizedSignature), Buffer.from(expected));
}

export async function syncLinkedInApplicants(tenantDb, options = {}) {
    const { models, settings, linkedinSettings, accessToken } = await getIntegrationContext(tenantDb, options);
    const { Candidate, JobPosting } = models;
    const jobs = options.jobs || (await resolveJobs(JobPosting, options));

    if (!jobs.length) {
        return {
            jobsProcessed: 0,
            created: 0,
            updated: 0,
            skipped: 0,
            errors: [],
            items: [],
        };
    }

    const applicantsEndpointTemplate = options.applicantsEndpointTemplate || DEFAULT_LINKEDIN_APPLICANTS_URL;
    const actorId = options.actorId || null;
    const summary = {
        jobsProcessed: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: [],
        items: [],
    };

    const applicantPayloadsByJob = options.applicantsByJob || {};
    const flatApplicants = Array.isArray(options.applicants) ? options.applicants : null;

    for (const job of jobs) {
        try {
            let applicants = applicantPayloadsByJob[job._id?.toString?.()] || applicantPayloadsByJob[job.linkedinJobPostingId] || null;

            if (!applicants && flatApplicants && jobs.length === 1) {
                applicants = flatApplicants;
            }

            if (!applicants) {
                if (!linkedinSettings.isActive) {
                    throw new Error('LinkedIn integration is not active for this tenant');
                }

                if (!accessToken) {
                    throw new Error('LinkedIn access token is unavailable for sync');
                }

                applicants = await fetchApplicantsForJob({
                    accessToken,
                    applicantsEndpointTemplate,
                    job,
                    since: options.since || linkedinSettings.lastSyncAt,
                    limit: options.limit,
                });
            }

            const normalizedApplicants = Array.isArray(applicants) ? applicants : [];
            summary.jobsProcessed += 1;

            for (const applicant of normalizedApplicants) {
                try {
                    const candidateData = normalizeLinkedInCandidateData({
                        applicant,
                        job,
                        actorId,
                        syncSource: options.syncSource || 'manual-sync',
                        override: options.overrideCandidateFields,
                    });

                    validateLinkedInCandidatePayload(candidateData);

                    const existingCandidate = await findExistingCandidateByLinkedInIdentity(Candidate, job._id, candidateData);
                    if (existingCandidate) {
                        const update = buildCandidateUpdate(
                            existingCandidate,
                            candidateData,
                            actorId,
                            options.updateNote || 'LinkedIn profile refreshed during sync'
                        );
                        await Candidate.findByIdAndUpdate(existingCandidate._id, update, { new: true, runValidators: true });
                        summary.updated += 1;
                        summary.items.push({
                            status: 'updated',
                            candidateId: existingCandidate._id,
                            email: candidateData.email,
                            jobPostingId: job._id,
                        });
                        continue;
                    }

                    const upsertResult = await upsertCandidate(tenantDb, candidateData, {
                        Candidate,
                        actorId,
                        applicationNote: options.applicationNote || 'Imported from LinkedIn',
                    });

                    if (upsertResult.created) {
                        summary.created += 1;
                        summary.items.push({
                            status: 'created',
                            candidateId: upsertResult.candidate._id,
                            email: candidateData.email,
                            jobPostingId: job._id,
                        });
                        continue;
                    }

                    summary.skipped += 1;
                    summary.items.push({
                        status: upsertResult.crossJobDuplicate ? 'cross-job-duplicate' : 'duplicate',
                        email: candidateData.email,
                        jobPostingId: job._id,
                        existingCandidateId: upsertResult.existingCandidate?._id || upsertResult.candidate?._id || null,
                    });
                } catch (error) {
                    summary.errors.push({
                        jobPostingId: job._id,
                        email: applicant?.email || applicant?.emailAddress || null,
                        message: error.message,
                    });
                }
            }
        } catch (error) {
            summary.errors.push({
                jobPostingId: job._id,
                message: error.message,
            });
        }
    }

    await markLinkedInSync(settings, tenantDb, {
        lastSyncAt: new Date(),
        lastSyncSummary: {
            jobsProcessed: summary.jobsProcessed,
            created: summary.created,
            updated: summary.updated,
            skipped: summary.skipped,
            errorCount: summary.errors.length,
        },
    });

    return summary;
}

export async function importLinkedInProfile(tenantDb, options = {}) {
    const { models } = await getIntegrationContext(tenantDb, options);
    const { Candidate, JobPosting } = models;
    const actorId = options.actorId || null;
    const jobPostingId = safeTrim(options.jobPosting || options.jobId || options.jobPostingId);

    if (!jobPostingId) {
        throw new Error('Job posting is required to import a LinkedIn profile');
    }

    const job = await JobPosting.findById(jobPostingId);
    if (!job) {
        throw new Error('Job posting not found');
    }

    const applicant = options.profileData || options.applicant || options.candidate || {};
    const candidateData = normalizeLinkedInCandidateData({
        applicant,
        job,
        actorId,
        syncSource: options.syncSource || 'profile-import',
        override: options.overrideCandidateFields,
    });

    validateLinkedInCandidatePayload(candidateData);

    const existingCandidate = await findExistingCandidateByLinkedInIdentity(Candidate, job._id, candidateData);
    if (existingCandidate) {
        const update = buildCandidateUpdate(
            existingCandidate,
            candidateData,
            actorId,
            options.updateNote || 'LinkedIn profile imported again'
        );
        const updatedCandidate = await Candidate.findByIdAndUpdate(existingCandidate._id, update, {
            new: true,
            runValidators: true,
        });

        return {
            status: 'updated',
            candidate: updatedCandidate,
        };
    }

    const upsertResult = await upsertCandidate(tenantDb, candidateData, {
        Candidate,
        actorId,
        applicationNote: options.applicationNote || 'Imported from LinkedIn profile',
    });

    if (upsertResult.created) {
        return {
            status: 'created',
            candidate: upsertResult.candidate,
        };
    }

    if (upsertResult.crossJobDuplicate) {
        return {
            status: 'cross-job-duplicate',
            existingCandidate: upsertResult.existingCandidate,
        };
    }

    return {
        status: 'duplicate',
        candidate: upsertResult.candidate,
    };
}