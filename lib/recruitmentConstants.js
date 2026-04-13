export const CANDIDATE_SOURCE_OPTIONS = [
    { value: 'website', label: 'Website' },
    { value: 'linkedin', label: 'LinkedIn' },
    { value: 'referral', label: 'Referral' },
    { value: 'naukri', label: 'Naukri' },
    { value: 'indeed', label: 'Indeed' },
    { value: 'glassdoor', label: 'Glassdoor' },
    { value: 'career-page', label: 'Career Page' },
    { value: 'agency', label: 'Agency' },
    { value: 'other', label: 'Other' },
];

export const CANDIDATE_SOURCE_VALUES = CANDIDATE_SOURCE_OPTIONS.map((option) => option.value);

export const CANDIDATE_SOURCE_LABELS = Object.fromEntries(
    CANDIDATE_SOURCE_OPTIONS.map((option) => [option.value, option.label])
);

export function getCandidateSourceLabel(source) {
    return CANDIDATE_SOURCE_LABELS[source] || source || 'Unknown';
}