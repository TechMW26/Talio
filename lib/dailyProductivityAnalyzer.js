/**
 * Daily productivity analyzer
 * --------------------------------
 * Analyzes a batch of screenshots for one user/employee/day via the AI vision
 * service, returns a structured analysis, and offers a helper to merge a new
 * analysis with an existing one (so subsequent "Analyze with MIRA" presses
 * combine pending images with prior analysis).
 *
 * No coupling to the legacy ProductivitySession concept — operates purely on
 * raw Screenshot docs and the per-day ScreenshotAnalysis aggregate.
 */

import { generateVisionContent } from '@/lib/gemini';
import { parseProductivityAnalysisResponse } from '@/lib/productivityAnalysisResult';
import { loadScreenshotsForAnalysisBatch } from '@/lib/productivityScreenshotLoader';

const MAX_IMAGES_PER_BATCH = 10;

function selectEvenlyDistributed(totalCount, maxSelect) {
  if (totalCount <= maxSelect) {
    return Array.from({ length: totalCount }, (_, i) => i);
  }
  const indices = [];
  const step = (totalCount - 1) / (maxSelect - 1);
  for (let i = 0; i < maxSelect; i++) indices.push(Math.round(i * step));
  return indices;
}

function formatTimeRange(screenshots) {
  if (!screenshots.length) return 'unknown';
  const first = new Date(screenshots[0].capturedAt);
  const last = new Date(screenshots[screenshots.length - 1].capturedAt);
  return `${first.toLocaleTimeString()} – ${last.toLocaleTimeString()}`;
}

function buildAnalysisPrompt({
  employeeName,
  employeeDesignation,
  employeeDepartment,
  employeeRole,
  kris,
  taskContextStr,
  dateString,
  screenshots,
  imagesAnalyzed,
  previousAnalysisSummary,
}) {
  let primaryRole = '';
  let fallback = '';
  if (employeeDesignation) primaryRole = `Designation/Job Title: ${employeeDesignation}`;
  if (!employeeDesignation && employeeDepartment) {
    fallback = `Department: ${employeeDepartment} (no specific job title; infer expected work)`;
  }
  if (employeeRole && employeeRole !== 'employee') {
    fallback += fallback ? `\n- System Role: ${employeeRole}` : `System Role: ${employeeRole}`;
  }
  const roleContext = primaryRole || fallback || 'Not specified - evaluate based on observed activities';
  const kriContext = kris.length > 0
    ? kris.map((item, i) => `${i + 1}. ${item}`).join('\n')
    : 'No explicit KRIs configured. Infer from designation and assigned tasks.';

  const previousContext = previousAnalysisSummary
    ? `\n\nPREVIOUS ANALYSIS CONTEXT (earlier batches today — incorporate, do NOT contradict):\n"""\n${previousAnalysisSummary}\n"""\n`
    : '';

  return `You are a STRICT and PRECISE workplace productivity analyst. Analyze computer desktop screenshots to assess ACTUAL work activities and productivity for a portion of an employee's workday.

CRITICAL ANALYSIS PRINCIPLES:
1. BE SKEPTICAL - Just having an app open does NOT mean productive work is happening
2. LOOK FOR EVIDENCE of actual work: typing, code changes, document edits, meaningful interactions
3. Static screens, paused videos, idle chats = LOW productivity
4. Entertainment sites (YouTube, Netflix, social media) = AUTOMATIC productivity penalty unless clearly work-related
5. Research should show ACTIVE reading/scrolling, not just an open page
6. For YouTube: Check if video is ACTUALLY PLAYING (progress bar, play button state). Paused or just open = idle time
7. Multiple browser tabs with entertainment = distraction pattern
8. Same screen across multiple screenshots = likely idle/inactive
9. COMPARE observed activities with ASSIGNED TASKS to determine task relativity

EMPLOYEE PROFILE:
- Name: ${employeeName}
- ${roleContext}

ROLE RESPONSIBILITIES (KRI CONTEXT - HIGH PRIORITY):
${kriContext}

IMPORTANT: The employee's DESIGNATION/JOB TITLE is the PRIMARY indicator of expected work type.
- A "Software Developer" should be coding, not doing HR work
- A "Graphic Designer" should be designing, not doing accounting
- Use the designation to judge if activities are role-appropriate
- Department name alone is NOT enough to determine expected work
- If activity appears non-core for the role but matches listed responsibilities, treat it as role-aligned.

ASSIGNED TASKS (Current workload - use this to determine if work is task-related):
${taskContextStr}

ROLE-SPECIFIC EXPECTATIONS (match based on DESIGNATION, not department):
- Developers/Engineers: Active coding (cursor in editor, code visible), terminal commands, documentation lookup
- Designers: Active design work in Figma/Photoshop, not just viewing
- Marketing: Campaign management, analytics review, content creation - NOT just social media browsing
- HR/Admin: Document editing, spreadsheet work, email composition (not just reading)
- Sales: CRM updates, email composition, call preparation - NOT general browsing
- QA/Testers: Testing tools, bug tracking, test case management
- Project Managers: Project management tools, documentation, team communication
- Data Analysts: Spreadsheets, analytics dashboards, data visualization tools

DAY CONTEXT:
- Date: ${dateString}
- Time Range Covered: ${formatTimeRange(screenshots)}
- Total New Screenshots: ${screenshots.length}
- Screenshots Being Analyzed: ${imagesAnalyzed}
${previousContext}
STRICT SCORING CRITERIA (be harsh but fair):
- 85-100: EXCEPTIONAL - Deep coding/design work with visible progress, minimal distractions, CLEARLY working on assigned tasks (RARE)
- 70-84: PRODUCTIVE - Consistent work activity with minor breaks, work appears related to assigned tasks
- 55-69: MODERATE - Mix of work and idle time, some task-related work but also distractions
- 40-54: BELOW AVERAGE - Significant idle time, work not clearly related to assigned tasks
- 25-39: POOR - Mostly entertainment/social media, ignoring assigned tasks
- 0-24: UNPRODUCTIVE - Entertainment, gaming, or completely idle screens despite having tasks

RED FLAGS (each reduces score by 10-20 points):
- YouTube/Netflix/Streaming open (unless clearly work tutorial being ACTIVELY watched)
- Social media (Twitter, Facebook, Instagram, Reddit, TikTok)
- Same exact screen in multiple screenshots (idle)
- Video paused or at 0:00 progress (opened but not watching)
- Chat apps without work context
- Gaming or game-related content
- Shopping websites
- News sites with no work relation

YOUTUBE DETECTION RULES:
- If YouTube is visible, CHECK THE VIDEO PROGRESS BAR
- Video at 0:00 or paused = NOT watching = count as distraction
- Video clearly mid-play with work-related title = could be learning
- Multiple YouTube tabs = likely entertainment binge
- YouTube with work tutorial AND notes/code open = productive learning

PATTERN ANALYSIS:
- Compare screenshots for CHANGES - same screen = idle
- Look for typing indicators, cursor positions, scroll changes
- Active work shows PROGRESSION between screenshots
- Idle shows static or repetitive screens

RESPOND WITH ONLY THIS JSON (no markdown, no code blocks):

OUTPUT RULES:
- Do NOT omit any keys. Use [] or null when you are unsure.
- Keep the summary detailed but concise: 2 short paragraphs, maximum 140 words total.
- Keep achievements, suggestions, insights, concerns, and redFlags to the 3-4 most important items.
- Keep applications, websites, and workCategories to the 5 most relevant items.
- Include one screenshotAnalysis entry for each analyzed screenshot, but keep each summary to one concise sentence.

{
  "sessionTitle": "<SHORT_2_TO_4_WORD_NAME_FOR_THIS_BATCH>",
  "summary": "Detailed 2 short paragraph analysis. Be specific about what was observed and mention the most important apps/sites seen.",
  "score": <STRICTLY_CALCULATED_0_TO_100>,
  "focusScore": <0_TO_100_BASED_ON_CONTEXT_SWITCHING_AND_DISTRACTIONS>,
  "taskCompletionIndicators": <0_TO_100_EVIDENCE_OF_ACTUAL_WORK_COMPLETED>,
  "timeDistribution": {
    "deepWork": <PERCENTAGE_ACTIVE_FOCUSED_WORK>,
    "collaboration": <PERCENTAGE_WORK_MEETINGS_OR_CHAT>,
    "administrative": <PERCENTAGE_EMAIL_DOCS>,
    "unfocused": <PERCENTAGE_ENTERTAINMENT_SOCIAL_MEDIA>,
    "idle": <PERCENTAGE_INACTIVE_OR_SAME_SCREEN>
  },
  "focusMetrics": {
    "longestFocusStreak": "<DURATION_OF_UNINTERRUPTED_WORK>",
    "contextSwitches": <NUMBER_OF_APP_SWITCHES>,
    "distractionCount": <COUNT_OF_NON_WORK_ACTIVITIES>,
    "idleScreensDetected": <COUNT_OF_UNCHANGED_SCREENSHOTS>
  },
  "achievements": ["Only list REAL accomplishments with evidence"],
  "suggestions": ["Specific actionable improvements based on observations"],
  "insights": ["Behavioral patterns noticed - both good and concerning"],
  "concerns": ["Any productivity concerns - be direct and specific"],
  "redFlags": ["List any red flags detected: entertainment, idle, etc."],
  "workCategories": [
    {"category": "Development/Coding", "percentage": <NUMBER>, "isActive": <true_if_actively_coding_false_if_just_open>},
    {"category": "Communication", "percentage": <NUMBER>, "isWorkRelated": <true_or_false>},
    {"category": "Entertainment", "percentage": <NUMBER>, "sites": ["list detected entertainment"]},
    {"category": "Research", "percentage": <NUMBER>, "isActive": <true_if_actively_reading>},
    {"category": "Idle/Inactive", "percentage": <NUMBER>, "reason": "why marked as idle"}
  ],
  "screenshotAnalysis": [
    {
      "index": 0,
      "summary": "DETAILED description - what EXACTLY is on screen",
      "activity": "coding|browsing|meeting|document|communication|design|idle|entertainment|research",
      "productivity": "high|medium|low|idle",
      "applicationVisible": "Exact app name",
      "websiteVisible": "Full domain if browser visible",
      "isActiveWork": <true_if_evidence_of_active_work_false_otherwise>,
      "concerns": "Any concerns about this specific screenshot",
      "youtubeStatus": "playing|paused|not_applicable - if YouTube visible"
    }
  ],
  "applications": [
    {
      "name": "Application name",
      "category": "development|communication|productivity|browser|entertainment|utility",
      "estimatedMinutes": <NUMBER>,
      "productivityImpact": "positive|neutral|negative",
      "wasActivelyUsed": <true_or_false>
    }
  ],
  "websites": [
    {
      "domain": "full domain",
      "category": "work|research|social|entertainment|shopping|news",
      "estimatedMinutes": <NUMBER>,
      "wasActivelyViewed": <true_if_scrolling_or_interaction_visible>
    }
  ],
  "taskRelativity": {
    "score": <0_TO_100_HOW_RELATED_TO_ASSIGNED_TASKS>,
    "matchedTasks": ["List task titles that appear to be worked on"],
    "unrelatedActivities": ["Activities that don't match any assigned task"],
    "assessment": "Brief assessment of how well work aligns with assigned tasks"
  },
  "overallAssessment": {
    "genuineWorkPercentage": <HONEST_ESTIMATE_OF_REAL_WORK>,
    "taskAlignmentPercentage": <PERCENTAGE_OF_WORK_RELATED_TO_TASKS>,
    "strengths": ["What was done well"],
    "majorConcerns": ["Direct concerns if any"],
    "areasForImprovement": ["Most important improvements needed"],
    "recommendation": "One sentence honest recommendation"
  }
}

CRITICAL REMINDERS:
1. Do NOT give high scores just because work apps are open - look for ACTIVE work
2. Entertainment = automatic score reduction
3. Same screen multiple times = idle time
4. Be HONEST - inflated scores don't help anyone improve
5. The "score" MUST reflect ACTUAL observed productivity, not potential
6. COMPARE work activities with assigned tasks - working on unrelated things when tasks are pending = lower score
7. If employee has IN-PROGRESS tasks but screenshots show unrelated activities = RED FLAG`;
}

/**
 * Run AI vision analysis over the supplied screenshot docs.
 * @returns {Promise<object>} Parsed analysis object
 */
export async function analyzeScreenshotBatch({
  screenshots,
  ScreenshotModel,
  databaseName,
  context,
  previousAnalysisSummary = null,
}) {
  if (!screenshots || screenshots.length === 0) {
    throw new Error('No screenshots to analyze');
  }

  const indices = selectEvenlyDistributed(screenshots.length, MAX_IMAGES_PER_BATCH);
  const selected = indices.map((i) => screenshots[i]);

  const { loaded, errors } = await loadScreenshotsForAnalysisBatch(
    selected.map((doc) => ({
      _id: doc._id,
      url: doc.imagekitUrl || doc.path || (doc._id ? `/api/activity/screenshot?id=${doc._id}` : null),
      path: doc.path,
      gridfsFileId: doc.gridfsFileId,
      capturedAt: doc.capturedAt,
    })),
    { ScreenshotModel, databaseName }
  );

  for (const { screenshot, error } of errors) {
    console.error('[DailyAnalyzer] Failed to load image', screenshot?.url || screenshot?.path, '-', error?.message);
  }

  const images = loaded.map(({ image }) => image);
  if (images.length === 0) {
    throw new Error('Failed to load any screenshots for analysis');
  }

  const prompt = buildAnalysisPrompt({
    employeeName: context.employeeName,
    employeeDesignation: context.employeeDesignation,
    employeeDepartment: context.employeeDepartment,
    employeeRole: context.employeeRole,
    kris: context.kris || [],
    taskContextStr: context.taskContextStr || 'No active tasks assigned',
    dateString: context.dateString,
    screenshots,
    imagesAnalyzed: images.length,
    previousAnalysisSummary,
  });

  const responseText = await generateVisionContent(prompt, images);
  if (!responseText || !responseText.trim()) {
    throw new Error('Empty AI response');
  }

  return parseProductivityAnalysisResponse(responseText);
}

function average(...values) {
  const filtered = values.map((v) => Number(v)).filter((v) => Number.isFinite(v));
  if (filtered.length === 0) return null;
  return Math.round(filtered.reduce((a, b) => a + b, 0) / filtered.length);
}

function uniqueStrings(arr, limit = 10) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    if (!item || typeof item !== 'string') continue;
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item.trim());
    if (out.length >= limit) break;
  }
  return out;
}

function mergeWeightedDistribution(prev, next, prevWeight, nextWeight) {
  const totalWeight = prevWeight + nextWeight;
  if (totalWeight <= 0) return next || prev || null;
  if (!prev) return next;
  if (!next) return prev;
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  const merged = {};
  for (const key of keys) {
    merged[key] = Math.round(((Number(prev[key]) || 0) * prevWeight + (Number(next[key]) || 0) * nextWeight) / totalWeight);
  }
  return merged;
}

/**
 * Combine an existing analysis with a freshly generated one for the same day.
 * Weighted by screenshot count so that batches with more captures pull the
 * combined score toward their value.
 */
export function mergeDailyAnalyses(previous, fresh, { previousCount = 0, freshCount = 0 } = {}) {
  if (!previous) return fresh;
  if (!fresh) return previous;

  const prevWeight = Math.max(previousCount, 1);
  const nextWeight = Math.max(freshCount, 1);
  const totalWeight = prevWeight + nextWeight;
  const weighted = (a, b) => {
    const av = Number(a);
    const bv = Number(b);
    if (!Number.isFinite(av) && !Number.isFinite(bv)) return null;
    if (!Number.isFinite(av)) return Math.round(bv);
    if (!Number.isFinite(bv)) return Math.round(av);
    return Math.round((av * prevWeight + bv * nextWeight) / totalWeight);
  };

  return {
    sessionTitle: fresh.sessionTitle || previous.sessionTitle || 'Daily Activity',
    summary: previous.summary
      ? `${previous.summary}\n\nLater in the day: ${fresh.summary || ''}`.trim()
      : (fresh.summary || ''),
    score: weighted(previous.score, fresh.score),
    focusScore: weighted(previous.focusScore, fresh.focusScore),
    taskCompletionIndicators: weighted(previous.taskCompletionIndicators, fresh.taskCompletionIndicators),
    timeDistribution: mergeWeightedDistribution(previous.timeDistribution, fresh.timeDistribution, prevWeight, nextWeight),
    focusMetrics: {
      longestFocusStreak: fresh.focusMetrics?.longestFocusStreak || previous.focusMetrics?.longestFocusStreak || null,
      contextSwitches: (Number(previous.focusMetrics?.contextSwitches) || 0) + (Number(fresh.focusMetrics?.contextSwitches) || 0),
      distractionCount: (Number(previous.focusMetrics?.distractionCount) || 0) + (Number(fresh.focusMetrics?.distractionCount) || 0),
      idleScreensDetected: (Number(previous.focusMetrics?.idleScreensDetected) || 0) + (Number(fresh.focusMetrics?.idleScreensDetected) || 0),
    },
    achievements: uniqueStrings([...(previous.achievements || []), ...(fresh.achievements || [])], 8),
    suggestions: uniqueStrings([...(previous.suggestions || []), ...(fresh.suggestions || [])], 8),
    insights: uniqueStrings([...(previous.insights || []), ...(fresh.insights || [])], 8),
    concerns: uniqueStrings([...(previous.concerns || []), ...(fresh.concerns || [])], 8),
    redFlags: uniqueStrings([...(previous.redFlags || []), ...(fresh.redFlags || [])], 8),
    workCategories: fresh.workCategories?.length ? fresh.workCategories : (previous.workCategories || []),
    applications: fresh.applications?.length ? fresh.applications : (previous.applications || []),
    websites: fresh.websites?.length ? fresh.websites : (previous.websites || []),
    screenshotAnalysis: [...(previous.screenshotAnalysis || []), ...(fresh.screenshotAnalysis || [])],
    taskRelativity: fresh.taskRelativity || previous.taskRelativity || null,
    overallAssessment: {
      genuineWorkPercentage: weighted(previous.overallAssessment?.genuineWorkPercentage, fresh.overallAssessment?.genuineWorkPercentage),
      taskAlignmentPercentage: weighted(previous.overallAssessment?.taskAlignmentPercentage, fresh.overallAssessment?.taskAlignmentPercentage),
      strengths: uniqueStrings([...(previous.overallAssessment?.strengths || []), ...(fresh.overallAssessment?.strengths || [])], 6),
      majorConcerns: uniqueStrings([...(previous.overallAssessment?.majorConcerns || []), ...(fresh.overallAssessment?.majorConcerns || [])], 6),
      areasForImprovement: uniqueStrings([...(previous.overallAssessment?.areasForImprovement || []), ...(fresh.overallAssessment?.areasForImprovement || [])], 6),
      recommendation: fresh.overallAssessment?.recommendation || previous.overallAssessment?.recommendation || '',
    },
  };
}

export { MAX_IMAGES_PER_BATCH };
