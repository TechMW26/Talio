function stripMarkdownCodeBlocks(text = '') {
    const trimmed = text.trim();
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    return codeBlockMatch ? codeBlockMatch[1].trim() : trimmed;
}

function tryParseJson(text) {
    if (!text || typeof text !== 'string') {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function trimDanglingJson(text) {
    let result = text.trimEnd();
    let previous = null;

    while (result && result !== previous) {
        previous = result;
        result = result
            .replace(/,\s*$/, '')
            .replace(/:\s*$/, '')
            .replace(/[\[{]\s*$/, '')
            .replace(/,\s*"[^"\\]*(?:\\.[^"\\]*)*"\s*$/, '')
            .trimEnd();
    }

    return result;
}

function closeIncompleteJson(fragment = '') {
    let result = fragment.trimEnd();
    const stack = [];
    let inString = false;
    let escaped = false;

    for (const char of result) {
        if (escaped) {
            escaped = false;
            continue;
        }

        if (inString) {
            if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }

        if (char === '{') {
            stack.push('}');
        } else if (char === '[') {
            stack.push(']');
        } else if ((char === '}' || char === ']') && stack[stack.length - 1] === char) {
            stack.pop();
        }
    }

    if (inString) {
        if (result.endsWith('\\')) {
            result = result.slice(0, -1);
        }
        result += '"';
    }

    result = trimDanglingJson(result);

    while (stack.length > 0) {
        result = result.replace(/,\s*$/, '');
        result += stack.pop();
    }

    return result;
}

function parseRecoveredJson(fragment = '') {
    const direct = tryParseJson(fragment);
    if (direct) {
        return direct;
    }

    let candidate = fragment.trim();
    let attempts = 0;

    while (candidate.length > 1 && attempts < 1500) {
        const repaired = closeIncompleteJson(candidate);
        const parsed = tryParseJson(repaired);
        if (parsed) {
            return parsed;
        }

        candidate = candidate.slice(0, -1).trimEnd();
        attempts += 1;
    }

    return null;
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractStructuredFragment(source, startIndex) {
    const fragment = source.slice(startIndex).trimStart();
    if (!fragment || !['{', '['].includes(fragment[0])) {
        return null;
    }

    const stack = [fragment[0] === '{' ? '}' : ']'];
    let inString = false;
    let escaped = false;
    let collected = '';

    for (const char of fragment) {
        collected += char;

        if (escaped) {
            escaped = false;
            continue;
        }

        if (inString) {
            if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }

        if (char === '{') {
            stack.push('}');
        } else if (char === '[') {
            stack.push(']');
        } else if ((char === '}' || char === ']') && stack[stack.length - 1] === char) {
            stack.pop();
            if (stack.length === 0) {
                return collected;
            }
        }
    }

    return closeIncompleteJson(collected);
}

function extractFieldValue(source, fieldName) {
    const fieldPattern = new RegExp(`"${escapeRegExp(fieldName)}"\\s*:\\s*`, 'm');
    const match = fieldPattern.exec(source);
    if (!match) {
        return undefined;
    }

    const valueStart = match.index + match[0].length;
    const indicator = source[valueStart];

    if (indicator === '{' || indicator === '[') {
        const fragment = extractStructuredFragment(source, valueStart);
        return fragment ? parseRecoveredJson(fragment) : undefined;
    }

    if (indicator === '"') {
        const parsed = parseRecoveredJson(source.slice(valueStart));
        return typeof parsed === 'string' ? parsed : undefined;
    }

    const primitiveMatch = source.slice(valueStart).match(/^(true|false|null|-?\d+(?:\.\d+)?)/);
    if (!primitiveMatch) {
        return undefined;
    }

    return tryParseJson(primitiveMatch[1]);
}

function extractKnownFields(source) {
    const fields = [
        'sessionTitle',
        'summary',
        'score',
        'focusScore',
        'taskCompletionIndicators',
        'timeDistribution',
        'focusMetrics',
        'achievements',
        'suggestions',
        'insights',
        'concerns',
        'redFlags',
        'workCategories',
        'screenshotAnalysis',
        'applications',
        'websites',
        'taskRelativity',
        'overallAssessment',
        'error'
    ];

    const extracted = {};
    for (const fieldName of fields) {
        const value = extractFieldValue(source, fieldName);
        if (value !== undefined) {
            extracted[fieldName] = value;
        }
    }

    if (Object.keys(extracted).length > 0) {
        extracted._repaired = true;
    }

    return extracted;
}

function asString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value) {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : null;
}

function clampPercentage(value) {
    const number = asNumber(value);
    if (number === null) {
        return null;
    }

    return Math.max(0, Math.min(100, Math.round(number)));
}

function normalizeStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map(item => asString(item))
        .filter(Boolean);
}

function normalizeTimeDistribution(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    return {
        deepWork: clampPercentage(value.deepWork) || 0,
        collaboration: clampPercentage(value.collaboration) || 0,
        administrative: clampPercentage(value.administrative) || 0,
        unfocused: clampPercentage(value.unfocused) || 0,
        idle: clampPercentage(value.idle) || 0
    };
}

function normalizeFocusMetrics(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    return {
        longestFocusStreak: asString(value.longestFocusStreak) || null,
        contextSwitches: asNumber(value.contextSwitches),
        distractionCount: asNumber(value.distractionCount),
        idleScreensDetected: asNumber(value.idleScreensDetected)
    };
}

function normalizeWorkCategories(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .filter(item => item && typeof item === 'object')
        .map(item => ({
            category: asString(item.category) || 'Other',
            percentage: clampPercentage(item.percentage) || 0,
            description: asString(item.description),
            isActive: typeof item.isActive === 'boolean' ? item.isActive : undefined,
            isWorkRelated: typeof item.isWorkRelated === 'boolean' ? item.isWorkRelated : undefined,
            sites: Array.isArray(item.sites) ? item.sites.map(site => asString(site)).filter(Boolean) : undefined,
            reason: asString(item.reason) || undefined
        }));
}

function normalizeScreenshotAnalysis(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .filter(item => item && typeof item === 'object')
        .map((item, index) => ({
            index: asNumber(item.index) ?? index,
            summary: asString(item.summary),
            activity: asString(item.activity),
            productivity: asString(item.productivity),
            applicationVisible: asString(item.applicationVisible),
            websiteVisible: asString(item.websiteVisible),
            isActiveWork: typeof item.isActiveWork === 'boolean' ? item.isActiveWork : false,
            concerns: asString(item.concerns),
            youtubeStatus: asString(item.youtubeStatus) || 'not_applicable'
        }));
}

function normalizeApplications(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .filter(item => item && typeof item === 'object')
        .map(item => ({
            name: asString(item.name) || 'Unknown',
            category: asString(item.category) || 'other',
            estimatedMinutes: asNumber(item.estimatedMinutes) || 0,
            productivityImpact: asString(item.productivityImpact) || 'neutral',
            wasActivelyUsed: typeof item.wasActivelyUsed === 'boolean' ? item.wasActivelyUsed : true
        }));
}

function normalizeWebsites(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .filter(item => item && typeof item === 'object')
        .map(item => ({
            domain: asString(item.domain) || asString(item.name) || asString(item.url) || 'Unknown',
            category: asString(item.category) || 'other',
            estimatedMinutes: asNumber(item.estimatedMinutes) || 0,
            wasActivelyViewed: typeof item.wasActivelyViewed === 'boolean' ? item.wasActivelyViewed : true
        }));
}

function normalizeTaskRelativity(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    return {
        score: clampPercentage(value.score),
        matchedTasks: normalizeStringArray(value.matchedTasks),
        unrelatedActivities: normalizeStringArray(value.unrelatedActivities),
        assessment: asString(value.assessment)
    };
}

function normalizeOverallAssessment(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    return {
        genuineWorkPercentage: clampPercentage(value.genuineWorkPercentage),
        taskAlignmentPercentage: clampPercentage(value.taskAlignmentPercentage),
        strengths: normalizeStringArray(value.strengths),
        majorConcerns: normalizeStringArray(value.majorConcerns),
        areasForImprovement: normalizeStringArray(value.areasForImprovement),
        recommendation: asString(value.recommendation)
    };
}

function inferScoreFromText(summary = '') {
    const lowerSummary = summary.toLowerCase();
    if (!lowerSummary) {
        return 60;
    }

    if (lowerSummary.includes('exceptional') || lowerSummary.includes('excellent') || lowerSummary.includes('highly productive')) {
        return 85;
    }

    if (lowerSummary.includes('productive') || lowerSummary.includes('focused') || lowerSummary.includes('consistent')) {
        return 70;
    }

    if (lowerSummary.includes('moderate') || lowerSummary.includes('average') || lowerSummary.includes('mixed')) {
        return 55;
    }

    return 60;
}

function deriveTimeDistributionFromScreenshots(screenshotAnalysis) {
    if (!Array.isArray(screenshotAnalysis) || screenshotAnalysis.length === 0) {
        return null;
    }

    const total = screenshotAnalysis.length;
    const buckets = {
        deepWork: 0,
        collaboration: 0,
        administrative: 0,
        unfocused: 0,
        idle: 0
    };

    for (const item of screenshotAnalysis) {
        const activity = asString(item.activity).toLowerCase();
        const productivity = asString(item.productivity).toLowerCase();

        if (productivity === 'idle' || activity === 'idle') {
            buckets.idle += 1;
        } else if (activity === 'communication' || activity === 'meeting') {
            buckets.collaboration += 1;
        } else if (activity === 'document' || activity === 'administrative') {
            buckets.administrative += 1;
        } else if (activity === 'entertainment' || productivity === 'low') {
            buckets.unfocused += 1;
        } else {
            buckets.deepWork += 1;
        }
    }

    return {
        deepWork: Math.round((buckets.deepWork / total) * 100),
        collaboration: Math.round((buckets.collaboration / total) * 100),
        administrative: Math.round((buckets.administrative / total) * 100),
        unfocused: Math.round((buckets.unfocused / total) * 100),
        idle: Math.round((buckets.idle / total) * 100)
    };
}

function deriveFocusMetricsFromScreenshots(screenshotAnalysis) {
    if (!Array.isArray(screenshotAnalysis) || screenshotAnalysis.length === 0) {
        return null;
    }

    let contextSwitches = 0;
    let distractionCount = 0;
    let idleScreensDetected = 0;
    let currentStreak = 0;
    let longestStreak = 0;
    let previousSurface = null;

    for (const item of screenshotAnalysis) {
        const currentSurface = asString(item.applicationVisible) || asString(item.websiteVisible) || asString(item.activity);
        const productivity = asString(item.productivity).toLowerCase();
        const activity = asString(item.activity).toLowerCase();

        if (previousSurface && currentSurface && currentSurface !== previousSurface) {
            contextSwitches += 1;
        }
        previousSurface = currentSurface || previousSurface;

        if (productivity === 'low' || productivity === 'idle' || activity === 'entertainment') {
            distractionCount += 1;
        }

        if (productivity === 'idle' || activity === 'idle') {
            idleScreensDetected += 1;
            currentStreak = 0;
        } else {
            currentStreak += 1;
            longestStreak = Math.max(longestStreak, currentStreak);
        }
    }

    return {
        longestFocusStreak: longestStreak > 0 ? `${longestStreak} screenshot${longestStreak > 1 ? 's' : ''}` : null,
        contextSwitches,
        distractionCount,
        idleScreensDetected
    };
}

function deriveWorkCategoriesFromTimeDistribution(timeDistribution) {
    if (!timeDistribution) {
        return [];
    }

    const categoryMap = [
        ['deepWork', 'Deep Work'],
        ['collaboration', 'Collaboration'],
        ['administrative', 'Administrative'],
        ['unfocused', 'Unfocused'],
        ['idle', 'Idle/Inactive']
    ];

    return categoryMap
        .map(([key, label]) => ({ category: label, percentage: timeDistribution[key] || 0 }))
        .filter(item => item.percentage > 0);
}

function deriveApplicationsFromScreenshots(screenshotAnalysis) {
    const counts = new Map();
    for (const item of screenshotAnalysis) {
        const name = asString(item.applicationVisible);
        if (!name) {
            continue;
        }

        counts.set(name, (counts.get(name) || 0) + 1);
    }

    return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => ({
            name,
            category: 'other',
            estimatedMinutes: count,
            productivityImpact: 'neutral',
            wasActivelyUsed: true
        }));
}

function deriveWebsitesFromScreenshots(screenshotAnalysis) {
    const counts = new Map();
    for (const item of screenshotAnalysis) {
        const domain = asString(item.websiteVisible);
        if (!domain) {
            continue;
        }

        counts.set(domain, (counts.get(domain) || 0) + 1);
    }

    return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([domain, count]) => ({
            domain,
            category: 'other',
            estimatedMinutes: count,
            wasActivelyViewed: true
        }));
}

function buildOverallAssessment(analysis) {
    const existing = analysis.overallAssessment || {};

    const strengths = existing.strengths?.length > 0
        ? existing.strengths
        : [...analysis.achievements, ...analysis.insights].slice(0, 3);

    const majorConcerns = existing.majorConcerns?.length > 0
        ? existing.majorConcerns
        : [...analysis.redFlags, ...analysis.concerns].slice(0, 3);

    const areasForImprovement = existing.areasForImprovement?.length > 0
        ? existing.areasForImprovement
        : analysis.suggestions.slice(0, 3);

    return {
        genuineWorkPercentage: existing.genuineWorkPercentage ?? analysis.taskCompletionIndicators ?? analysis.focusScore ?? analysis.score,
        taskAlignmentPercentage: existing.taskAlignmentPercentage ?? analysis.taskRelativity?.score ?? null,
        strengths,
        majorConcerns,
        areasForImprovement,
        recommendation: existing.recommendation || analysis.suggestions[0] || ''
    };
}

export function normalizeProductivityAnalysisResult(raw = {}) {
    const screenshotAnalysis = normalizeScreenshotAnalysis(raw.screenshotAnalysis);

    const analysis = {
        sessionTitle: asString(raw.sessionTitle),
        summary: asString(raw.summary),
        score: clampPercentage(raw.score),
        focusScore: clampPercentage(raw.focusScore),
        taskCompletionIndicators: clampPercentage(raw.taskCompletionIndicators),
        timeDistribution: normalizeTimeDistribution(raw.timeDistribution),
        focusMetrics: normalizeFocusMetrics(raw.focusMetrics),
        achievements: normalizeStringArray(raw.achievements),
        suggestions: normalizeStringArray(raw.suggestions),
        insights: normalizeStringArray(raw.insights),
        concerns: normalizeStringArray(raw.concerns),
        redFlags: normalizeStringArray(raw.redFlags),
        workCategories: normalizeWorkCategories(raw.workCategories),
        screenshotAnalysis,
        applications: normalizeApplications(raw.applications),
        websites: normalizeWebsites(raw.websites),
        taskRelativity: normalizeTaskRelativity(raw.taskRelativity),
        overallAssessment: normalizeOverallAssessment(raw.overallAssessment),
        error: asString(raw.error) || null,
        _repaired: raw._repaired === true
    };

    if (!analysis.summary && analysis.screenshotAnalysis.length > 0) {
        analysis.summary = analysis.screenshotAnalysis
            .map(item => item.summary)
            .filter(Boolean)
            .slice(0, 3)
            .join(' ');
    }

    if (analysis.score === null) {
        analysis.score = inferScoreFromText(analysis.summary);
    }

    if (!analysis.timeDistribution) {
        analysis.timeDistribution = deriveTimeDistributionFromScreenshots(analysis.screenshotAnalysis);
    }

    if (!analysis.focusMetrics) {
        analysis.focusMetrics = deriveFocusMetricsFromScreenshots(analysis.screenshotAnalysis);
    }

    if (analysis.workCategories.length === 0 && analysis.timeDistribution) {
        analysis.workCategories = deriveWorkCategoriesFromTimeDistribution(analysis.timeDistribution);
    }

    if (analysis.applications.length === 0 && analysis.screenshotAnalysis.length > 0) {
        analysis.applications = deriveApplicationsFromScreenshots(analysis.screenshotAnalysis);
    }

    if (analysis.websites.length === 0 && analysis.screenshotAnalysis.length > 0) {
        analysis.websites = deriveWebsitesFromScreenshots(analysis.screenshotAnalysis);
    }

    analysis.overallAssessment = buildOverallAssessment(analysis);

    if (!analysis.taskRelativity && analysis.overallAssessment?.taskAlignmentPercentage != null) {
        analysis.taskRelativity = {
            score: analysis.overallAssessment.taskAlignmentPercentage,
            matchedTasks: [],
            unrelatedActivities: [],
            assessment: ''
        };
    }

    if (!analysis.sessionTitle) {
        analysis.sessionTitle = analysis.applications[0]?.name || 'Work Session';
    }

    return analysis;
}

export function enrichPersistedProductivityAnalysis(raw = {}) {
    return {
        ...raw,
        ...normalizeProductivityAnalysisResult(raw)
    };
}

export function parseProductivityAnalysisResponse(responseText) {
    const jsonText = stripMarkdownCodeBlocks(responseText);

    const directParsed = tryParseJson(jsonText);
    if (directParsed) {
        return normalizeProductivityAnalysisResult(directParsed);
    }

    const firstBraceIndex = jsonText.indexOf('{');
    if (firstBraceIndex !== -1) {
        const rootCandidate = jsonText.slice(firstBraceIndex);
        const recovered = parseRecoveredJson(rootCandidate);
        if (recovered) {
            recovered._repaired = true;
            return normalizeProductivityAnalysisResult(recovered);
        }
    }

    const extractedFields = extractKnownFields(jsonText);
    if (Object.keys(extractedFields).length > 0) {
        return normalizeProductivityAnalysisResult(extractedFields);
    }

    throw new Error('Failed to parse AI response as JSON');
}