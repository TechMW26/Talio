import { getTenantModels } from '@/lib/tenantModels';
import { CANDIDATE_SOURCE_VALUES } from '@/lib/recruitmentConstants';

function resolveTenantDatabaseName(tenantDb) {
    if (typeof tenantDb === 'string') {
        return tenantDb;
    }

    if (tenantDb?.databaseName) {
        return tenantDb.databaseName;
    }

    if (tenantDb?.db?.databaseName) {
        return tenantDb.db.databaseName;
    }

    if (tenantDb?.name) {
        return tenantDb.name;
    }

    throw new Error('Tenant database context is required');
}

function normalizeCandidateSource(source) {
    const normalizedSource = source || 'website';

    if (!CANDIDATE_SOURCE_VALUES.includes(normalizedSource)) {
        throw new Error(`Invalid candidate source: ${normalizedSource}`);
    }

    return normalizedSource;
}

function normalizeCandidateData(candidateData, options = {}) {
    const createdBy = candidateData.createdBy || options.actorId;
    const totalExperience = candidateData.totalExperience ?? candidateData.experience;

    return {
        ...candidateData,
        email: candidateData.email?.toLowerCase().trim(),
        firstName: candidateData.firstName?.trim(),
        lastName: candidateData.lastName?.trim(),
        phone: candidateData.phone?.trim(),
        currentCompany: candidateData.currentCompany?.trim(),
        currentDesignation: candidateData.currentDesignation?.trim(),
        source: normalizeCandidateSource(candidateData.source),
        totalExperience,
        createdBy,
    };
}

export async function upsertCandidate(tenantDb, candidateData, options = {}) {
    const databaseName = resolveTenantDatabaseName(tenantDb);
    const Candidate = options.Candidate || options.models?.Candidate || (await getTenantModels(databaseName, ['Candidate'])).Candidate;

    const normalizedCandidate = normalizeCandidateData(candidateData, options);

    if (!normalizedCandidate.email) {
        throw new Error('Candidate email is required');
    }

    if (!normalizedCandidate.jobPosting) {
        throw new Error('Job posting is required');
    }

    const exactCandidate = await Candidate.findOne({
        email: normalizedCandidate.email,
        jobPosting: normalizedCandidate.jobPosting,
    });

    if (exactCandidate) {
        return { existed: true, candidate: exactCandidate };
    }

    const existingCandidate = await Candidate.findOne({
        email: normalizedCandidate.email,
    });

    if (existingCandidate) {
        return { crossJobDuplicate: true, existingCandidate };
    }

    const stage = 'applied';
    const stageMovedBy = normalizedCandidate.createdBy || options.actorId;
    const candidate = await Candidate.create({
        ...normalizedCandidate,
        stage,
        stageHistory: [{
            stage,
            movedAt: new Date(),
            movedBy: stageMovedBy,
            notes: options.applicationNote || 'Application submitted',
        }],
    });

    return { created: true, candidate };
}