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

import { generateVisionContent, generateStitchedVisionContent } from '@/lib/gemini';
import { parseProductivityAnalysisResponse } from '@/lib/productivityAnalysisResult';
import { loadScreenshotsForAnalysisBatch } from '@/lib/productivityScreenshotLoader';

// How many screenshots to feed the vision model in one batch. Kept small so
// each tile in the contact sheet is large enough for the model to actually
// read on-screen text, code and URLs. The analyze route loops over multiple
// batches to cover all pending screenshots.
const MAX_IMAGES_PER_BATCH = Math.max(
  2,
  Math.min(12, parseInt(process.env.PRODUCTIVITY_MAX_IMAGES_PER_BATCH || '6', 10) || 6),
);

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
  kpis,
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
  const kriContext = kris && kris.length > 0
    ? kris.map((item, i) => `${i + 1}. ${item}`).join('\n')
    : 'No explicit KRIs configured. Infer from designation and assigned tasks.';

  const kpiContext = Array.isArray(kpis) && kpis.length > 0
    ? kpis.map((kpi, i) => {
        const target = kpi.target ? ` \u2014 target: ${kpi.target}${kpi.unit ? ` ${kpi.unit}` : ''}` : '';
        const notes = kpi.notes ? ` (${kpi.notes})` : '';
        return `${i + 1}. ${kpi.name || 'Unnamed KPI'}${target}${notes}`;
      }).join('\n')
    : 'No measurable KPIs configured.';

  const previousContext = previousAnalysisSummary
    ? `\n\nPREVIOUS ANALYSIS CONTEXT (earlier batches today — incorporate, do NOT contradict):\n"""\n${previousAnalysisSummary}\n"""\n`
    : '';

  return `You are a STRICT, EVIDENCE-FIRST workplace productivity analyst. You will be shown a labeled CONTACT SHEET of one employee's desktop screenshots (each tile is labeled "SCREENSHOT 1", "SCREENSHOT 2", … in reading order, left-to-right, top-to-bottom). Analyze ONLY what is actually visible — do NOT invent activities, applications, websites, or task progress.

ABSOLUTE RULES (violating any of these makes the analysis worthless):
1. EVIDENCE OR SILENCE. Every claim about an app, website, video, document or activity MUST be backed by something legibly visible in the contact sheet. If you cannot read it, do NOT name it.
2. NEVER FABRICATE. Do not list applications, websites, task titles, file names, code languages, video titles, or chat conversations that you cannot literally see.
3. ADMIT ILLEGIBILITY. If a tile is too small / blurry / dark to identify, the matching screenshotAnalysis entry MUST set: applicationVisible "unknown", websiteVisible null, productivity "idle", isActiveWork false, summary "Tile not legible enough to identify activity."
3a. NO CONTRADICTIONS. If you mark a tile as illegible/unknown, you MUST NOT mention any specific app/site/title/URL in that same tile summary. If any specific app/site text is readable, do NOT mark that tile as illegible.
4. ONE screenshotAnalysis ENTRY PER TILE. Use the exact label number (SCREENSHOT N → index N-1). Do NOT add entries for tiles that don't exist. Do NOT skip tiles.
5. QUOTE WHAT YOU SEE. In each summary, briefly quote a piece of on-screen text (window title, URL, button label, file name, code keyword) as evidence. If nothing is readable, say so.
6. NO TIME GUESSING WITHOUT EVIDENCE. Estimated minutes for apps/websites must be proportionate ONLY to how many tiles show that app/site. If an app appears in 0 tiles, do NOT list it.

CRITICAL ANALYSIS PRINCIPLES:
- BE SKEPTICAL — just having an app open does NOT mean productive work is happening.
- Static screens / paused videos / idle chats / lock screens = LOW productivity.
- Entertainment sites (YouTube, Netflix, Reddit, social media) = automatic productivity penalty unless clearly work-related and ACTIVELY being used.
- Same screen across multiple consecutive tiles = idle.
- COMPARE observed activities with the ASSIGNED TASKS / KRIs / KPIs to determine task relativity.

INTENT & RELEVANCY INFERENCE (HIGH PRIORITY):
- For media/idea platforms (YouTube, Behance, Dribbble, Pinterest, Instagram, Reddit, etc.), decide between "work research" vs "casual entertainment" using visible evidence across nearby tiles, not a single-frame assumption.
- Count as WORK RESEARCH only if at least one of these is visible: role-aligned search terms, tutorial/problem-solving keywords, tool-specific references (e.g., Premiere/After Effects/Figma/Blender), visible note-taking, switching from media to actual production tools/docs/tasks.
- Count as CASUAL ENTERTAINMENT if visible signals include: homepage/feed doom-scroll, unrelated shorts/reels, comments/chat without work context, repeated passive viewing, no transition to execution tools.
- For creative roles (video editor, designer, content creator), media browsing can be productive IF evidence shows ideation/reference gathering tied to assigned tasks or deliverables.
- For non-creative roles, media browsing requires stronger evidence to be considered productive; otherwise score it as distraction.
- Use confidence language in summary when evidence is partial: "likely research" / "likely casual browsing".

EMPLOYEE PROFILE:
- Name: ${employeeName}
- ${roleContext}

ROLE RESPONSIBILITIES (KRI CONTEXT - HIGH PRIORITY):
${kriContext}

MEASURABLE KPIs (what this employee is judged on - score productivity ONLY against these):
${kpiContext}

IMPORTANT: The employee's DESIGNATION/JOB TITLE is the PRIMARY indicator of expected work type.
- A "Software Developer" should be coding, not doing HR work.
- A "Graphic Designer" should be designing, not doing accounting.
- If activity appears non-core for the role but matches listed responsibilities, treat it as role-aligned.
- An activity is "productive" ONLY if it advances at least one KRI, KPI, or assigned task. Generic browsing of an unrelated work app is NOT enough.

ASSIGNED TASKS (Current workload - use this to determine if work is task-related):
${taskContextStr}

ROLE-SPECIFIC EXPECTATIONS (match based on DESIGNATION, not department):
- Developers/Engineers: Active coding (cursor in editor, code visible), terminal commands, documentation lookup
- Designers: Active design work in Figma/Photoshop, not just viewing
- Marketing: Campaign management, analytics review, content creation — NOT just social media browsing
- HR/Admin: Document editing, spreadsheet work, email composition (not just reading)
- Sales: CRM updates, email composition, call preparation — NOT general browsing
- QA/Testers: Testing tools, bug tracking, test case management
- Project Managers: Project management tools, documentation, team communication
- Data Analysts: Spreadsheets, analytics dashboards, data visualization tools

DAY CONTEXT:
- Date: ${dateString}
- Time Range Covered: ${formatTimeRange(screenshots)}
- Total New Screenshots in this batch: ${screenshots.length}
- Tiles in the contact sheet: ${imagesAnalyzed} (numbered SCREENSHOT 1 … SCREENSHOT ${imagesAnalyzed})
${previousContext}
STRICT SCORING CRITERIA (be harsh but fair, evidence only):
- 85-100: EXCEPTIONAL — Deep coding/design work with visible progress, minimal distractions, CLEARLY working on assigned tasks (RARE)
- 70-84: PRODUCTIVE — Consistent work activity with minor breaks, work appears related to assigned tasks
- 55-69: MODERATE — Mix of work and idle time, some task-related work but also distractions
- 40-54: BELOW AVERAGE — Significant idle time, work not clearly related to assigned tasks
- 25-39: POOR — Mostly entertainment/social media, ignoring assigned tasks
- 0-24: UNPRODUCTIVE — Entertainment, gaming, idle screens, or majority illegible/unknown tiles

If MORE THAN HALF the tiles are illegible / unknown, the score MUST be ≤ 40 and the summary MUST say so.

RED FLAGS (each reduces score by 10-20 points, only if visible):
- YouTube/Netflix/Streaming open (unless clearly work tutorial being ACTIVELY watched)
- Social media (Twitter/X, Facebook, Instagram, Reddit, TikTok)
- Same exact screen in multiple tiles (idle)
- Video paused or at 0:00 progress
- Chat apps without work context
- Gaming or game-related content
- Shopping websites
- News sites with no work relation

YOUTUBE DETECTION RULES:
- Only flag YouTube if the YouTube logo / red play button / video player chrome is actually visible.
- Video at 0:00 or paused = NOT watching = count as distraction.
- Multiple YouTube tabs = likely entertainment.
- YouTube + visible notes/code = productive learning.
- YouTube for creative reference is productive only when tied to visible role/task cues (search intent, project notes, editing/design follow-through).

PATTERN ANALYSIS:
- Compare consecutive tiles for CHANGES — same screen = idle.
- Look for typing indicators, cursor positions, scroll changes.

OUTPUT RULES:
- Respond with ONLY the JSON object below. No markdown. No code fences. No prose before or after.
- Do NOT omit any keys. Use [] or null when unsure.
- Keep the summary detailed but concise: 2 short paragraphs, maximum 140 words total.
- Keep achievements, suggestions, insights, concerns, redFlags to the 3-4 most important items.
- Keep applications, websites, workCategories to the 5 most relevant items — only items you actually saw.
- Include EXACTLY ${imagesAnalyzed} screenshotAnalysis entries (one per tile, indexes 0..${imagesAnalyzed - 1}).

{
  "sessionTitle": "<SHORT_2_TO_4_WORD_NAME_FOR_THIS_BATCH>",
  "summary": "Detailed 2 short paragraph analysis grounded in what was visible. Quote at least one concrete piece of on-screen text as evidence (window title, URL, file name, code keyword).",
  "score": <STRICTLY_CALCULATED_0_TO_100>,
  "focusScore": <0_TO_100_BASED_ON_CONTEXT_SWITCHING_AND_DISTRACTIONS>,
  "taskCompletionIndicators": <0_TO_100_EVIDENCE_OF_ACTUAL_WORK_COMPLETED>,
  "timeDistribution": {
    "deepWork": <PERCENTAGE_ACTIVE_FOCUSED_WORK>,
    "collaboration": <PERCENTAGE_WORK_MEETINGS_OR_CHAT>,
    "administrative": <PERCENTAGE_EMAIL_DOCS>,
    "unfocused": <PERCENTAGE_ENTERTAINMENT_SOCIAL_MEDIA>,
    "idle": <PERCENTAGE_INACTIVE_OR_SAME_SCREEN_OR_ILLEGIBLE>
  },
  "focusMetrics": {
    "longestFocusStreak": "<DURATION_OF_UNINTERRUPTED_WORK>",
    "contextSwitches": <NUMBER_OF_APP_SWITCHES>,
    "distractionCount": <COUNT_OF_NON_WORK_ACTIVITIES>,
    "idleScreensDetected": <COUNT_OF_UNCHANGED_OR_ILLEGIBLE_SCREENSHOTS>
  },
  "achievements": ["Only list REAL accomplishments visible in the tiles"],
  "suggestions": ["Specific actionable improvements based on observations"],
  "insights": ["Behavioral patterns noticed - both good and concerning"],
  "concerns": ["Any productivity concerns - be direct and specific"],
  "redFlags": ["List any red flags ACTUALLY VISIBLE: entertainment, idle, etc."],
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
      "summary": "DETAILED description of what is visible in SCREENSHOT 1, with a short verbatim quote of any on-screen text. If the tile is illegible, say so explicitly.",
      "activity": "coding|browsing|meeting|document|communication|design|idle|entertainment|research|unknown",
      "productivity": "high|medium|low|idle",
      "applicationVisible": "Exact app name, or 'unknown' if not legibly identifiable",
      "websiteVisible": "Full domain if legibly visible, otherwise null",
      "isActiveWork": <true_if_evidence_of_active_work_false_otherwise>,
      "concerns": "Any concerns about this specific screenshot",
      "youtubeStatus": "playing|paused|not_applicable"
    }
  ],
  "applications": [
    {
      "name": "Application name (only if visibly identified)",
      "category": "development|communication|productivity|browser|entertainment|utility",
      "estimatedMinutes": <NUMBER>,
      "productivityImpact": "positive|neutral|negative",
      "wasActivelyUsed": <true_or_false>
    }
  ],
  "websites": [
    {
      "domain": "full domain (only if visibly identified)",
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

FINAL REMINDERS:
1. Do NOT give high scores just because work apps are open — require ACTIVE work evidence.
2. Entertainment = automatic score reduction.
3. Same screen multiple times = idle time.
4. Be HONEST — inflated scores don't help anyone improve.
5. The "score" MUST reflect ACTUAL observed productivity, not potential.
6. COMPARE work activities with assigned tasks — working on unrelated things when tasks are pending = lower score.
7. If employee has IN-PROGRESS tasks but tiles show unrelated activities = RED FLAG.
8. NEVER name an app, website or task you cannot actually see in the tiles.`;
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
    kpis: context.kpis || [],
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

// ---------------------------------------------------------------------------
// Single-shot stitched-composite analyzer
// ---------------------------------------------------------------------------

function formatTileTimestamp(value) {
  try {
    return new Date(value).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return String(value || 'unknown');
  }
}

function buildStitchedAnalysisPrompt({
  employeeName,
  employeeDesignation,
  employeeDepartment,
  employeeRole,
  kris,
  kpis,
  taskContextStr,
  dateString,
  tiles,
  columns,
  rows,
  tileWidth,
  tileHeight,
  gap,
  previousAnalysisSummary,
}) {
  const primaryRole = employeeDesignation
    ? `Designation/Job Title: ${employeeDesignation}`
    : (employeeDepartment
      ? `Department: ${employeeDepartment} (no specific job title; infer expected work)`
      : 'Not specified - evaluate based on observed activities');

  const roleLine = employeeRole && employeeRole !== 'employee'
    ? `\n- System Role: ${employeeRole}`
    : '';

  const kriContext = kris && kris.length > 0
    ? kris.map((item, i) => `${i + 1}. ${item}`).join('\n')
    : 'No explicit KRIs configured. Infer from designation and assigned tasks.';

  const kpiContext = Array.isArray(kpis) && kpis.length > 0
    ? kpis.map((kpi, i) => {
        const target = kpi.target ? ` \u2014 target: ${kpi.target}${kpi.unit ? ` ${kpi.unit}` : ''}` : '';
        const notes = kpi.notes ? ` (${kpi.notes})` : '';
        return `${i + 1}. ${kpi.name || 'Unnamed KPI'}${target}${notes}`;
      }).join('\n')
    : 'No measurable KPIs configured.';

  const previousContext = previousAnalysisSummary
    ? `\n\nPREVIOUS ANALYSIS CONTEXT (your earlier reading of this same day, before today's newest tiles were appended). Use it for continuity, but the FRESH composite below is the ground truth — if it contradicts the prior summary, trust the composite:\n"""\n${previousAnalysisSummary}\n"""\n`
    : '';

  // Per-tile reference table the model can use to map index -> timestamp
  // and exact grid position for screen-level reasoning.
  const tileTable = tiles
    .map((t) => {
      const n = Number(t.index) + 1;
      const col = Number(t.index) % Number(columns);
      const row = Math.floor(Number(t.index) / Number(columns));
      const hintApp = `${t.captureActiveApp || ''}`.trim();
      const hintWindow = `${t.captureActiveWindow || ''}`.trim();
      const hint = (hintApp || hintWindow)
        ? `, capture telemetry hint: app="${hintApp || 'unknown'}", window="${hintWindow || 'unknown'}"`
        : '';
      return `  - SCREENSHOT ${n} (index ${t.index}, SCREEN_ID S${n}): row ${row}, col ${col}, captured ${formatTileTimestamp(t.capturedAt)}${hint}`;
    })
    .join('\n');

  const totalTiles = tiles.length;

  return `You are a STRICT, EVIDENCE-FIRST workplace productivity analyst. You will be shown ONE LARGE STITCHED COMPOSITE image that contains every desktop screenshot captured for this employee on the requested day.

COMPOSITE LAYOUT — read carefully:
- The composite is a fixed grid of ${columns} column(s) × ${rows} row(s).
- Each individual tile is exactly ${tileWidth}px wide and ${tileHeight}px tall, with ${gap}px gap between tiles.
- Tiles are arranged left-to-right, top-to-bottom in CHRONOLOGICAL order of capture.
- The composite contains exactly ${totalTiles} tiles. They are numbered SCREENSHOT 1 … SCREENSHOT ${totalTiles}, where SCREENSHOT N is at column ((N-1) mod ${columns}) and row floor((N-1) / ${columns}) (0-indexed).

PER-TILE TIMESTAMP MAP (use this to anchor activity timing):
${tileTable}

IMPORTANT SCREEN-LEVEL INTERPRETATION:
- Treat each tile as a distinct SCREEN_ID (S1..S${totalTiles}) with its own timestamp.
- A single tile can contain multiple visible windows/panels/monitors. Capture primary + secondary activity in that tile summary if both are visible.
- If multiple apps are visible, mark productivity based on the dominant user action (what appears actively used), not just what is open.

ABSOLUTE RULES (violating any of these makes the analysis worthless):
1. EVIDENCE OR SILENCE. Every claim about an app, website, video, document or activity MUST be backed by something legibly visible in the corresponding tile of the composite. If you cannot read it, do NOT name it.
2. NEVER FABRICATE. Do not list applications, websites, task titles, file names, code languages, video titles, or chat conversations that you cannot literally see.
2a. If top-level sections (summary/achievements/insights/applications/websites) mention an app or site, that app/site MUST appear in at least one screenshotAnalysis tile entry as visible evidence.
3. ADMIT ILLEGIBILITY. If a tile is too small / blurry / dark to identify, the matching screenshotAnalysis entry MUST set: applicationVisible "unknown", websiteVisible null, productivity "idle", isActiveWork false, summary "Tile not legible enough to identify activity."
3a. NO CONTRADICTIONS. If a tile is marked illegible/unknown, do NOT mention any specific app/site/title/URL in that same tile summary.
4. EXACTLY ONE screenshotAnalysis ENTRY PER TILE. Use the same numbering as the layout (SCREENSHOT N -> index N-1). Do NOT add entries for tiles that don't exist. Do NOT skip tiles. There MUST be exactly ${totalTiles} entries with indexes 0..${totalTiles - 1}.
5. QUOTE WHAT YOU SEE. In each summary, briefly quote a piece of on-screen text (window title, URL, button label, file name, code keyword) as evidence. If nothing is readable, say so.
6. NO TIME GUESSING WITHOUT EVIDENCE. Estimated minutes for apps/websites must be proportionate ONLY to how many tiles show that app/site. If an app appears in 0 tiles, do NOT list it.

CRITICAL ANALYSIS PRINCIPLES:
- BE SKEPTICAL — just having an app open does NOT mean productive work is happening.
- Static screens / paused videos / idle chats / lock screens = LOW productivity.
- Entertainment sites (YouTube, Netflix, Reddit, social media) = automatic productivity penalty unless clearly work-related and ACTIVELY being used.
- Same screen across multiple consecutive tiles = idle.
- COMPARE observed activities with the ASSIGNED TASKS / KRIs / KPIs to determine task relativity.
- Distinguish creative/role-related research vs casual browsing using visible intent cues (search query, note-taking, transitions into execution tools, task-linked keywords).

APP / SITE DISAMBIGUATION (VERY IMPORTANT):
- Do NOT infer specific apps/sites from generic visual shapes, colors, thumbnails, or layouts alone.
- Name an app/site only when there is explicit readable evidence in that tile (title text, URL, logo, tab label, or window chrome).
- If uncertain, use "unknown" instead of guessing.

EMPLOYEE PROFILE:
- Name: ${employeeName}
- ${primaryRole}${roleLine}

ROLE RESPONSIBILITIES (KRI CONTEXT - HIGH PRIORITY):
${kriContext}

MEASURABLE KPIs (what this employee is judged on - score productivity ONLY against these):
${kpiContext}

ASSIGNED TASKS (Current workload - use this to determine if work is task-related):
${taskContextStr}

DAY CONTEXT:
- Date: ${dateString}
- Total tiles in this composite: ${totalTiles}
${previousContext}
STRICT SCORING CRITERIA (be harsh but fair, evidence only):
- 85-100: EXCEPTIONAL — Deep coding/design work with visible progress, minimal distractions, CLEARLY working on assigned tasks (RARE)
- 70-84: PRODUCTIVE — Consistent work activity with minor breaks, work appears related to assigned tasks
- 55-69: MODERATE — Mix of work and idle time, some task-related work but also distractions
- 40-54: BELOW AVERAGE — Significant idle time, work not clearly related to assigned tasks
- 25-39: POOR — Mostly entertainment/social media, ignoring assigned tasks
- 0-24: UNPRODUCTIVE — Entertainment, gaming, idle screens, or majority illegible/unknown tiles

If MORE THAN HALF the tiles are illegible / unknown, the score MUST be ≤ 40 and the summary MUST say so.

OUTPUT RULES:
- Respond with ONLY the JSON object below. No markdown. No code fences. No prose before or after.
- Do NOT omit any keys. Use [] or null when unsure.
- The summary must be a DETAILED, POINT-BY-POINT full-day chronology with 6-10 numbered lines in plain text, each point anchored to one or more SCREEN_ID(s)/timestamps from the map.
- Each summary point MUST be on its own new line. Do NOT collapse all points into one paragraph.
- The summary MUST faithfully reflect the dominant patterns in screenshotAnalysis. Do not claim "nothing visible" if many tiles are legible.
- Keep achievements, suggestions, insights, concerns, redFlags to the 3-5 most important items each.
- Keep applications, websites, workCategories to the 6 most relevant items — only items you actually saw.
- Include EXACTLY ${totalTiles} screenshotAnalysis entries (one per tile, indexes 0..${totalTiles - 1}).

{
  "sessionTitle": "<SHORT_2_TO_4_WORD_NAME_FOR_THE_DAY>",
  "summary": "Detailed point-by-point day chronology (6-10 numbered lines). Put each numbered point on a separate new line. Each point must reference SCREEN_ID(s) and/or timestamp(s) from the map, and include concrete visual evidence quotes.",
  "score": <STRICTLY_CALCULATED_0_TO_100>,
  "focusScore": <0_TO_100_BASED_ON_CONTEXT_SWITCHING_AND_DISTRACTIONS>,
  "taskCompletionIndicators": <0_TO_100_EVIDENCE_OF_ACTUAL_WORK_COMPLETED>,
  "timeDistribution": {
    "deepWork": <PERCENTAGE_ACTIVE_FOCUSED_WORK>,
    "collaboration": <PERCENTAGE_WORK_MEETINGS_OR_CHAT>,
    "administrative": <PERCENTAGE_EMAIL_DOCS>,
    "unfocused": <PERCENTAGE_ENTERTAINMENT_SOCIAL_MEDIA>,
    "idle": <PERCENTAGE_INACTIVE_OR_SAME_SCREEN_OR_ILLEGIBLE>
  },
  "focusMetrics": {
    "longestFocusStreak": "<DURATION_OF_UNINTERRUPTED_WORK>",
    "contextSwitches": <NUMBER_OF_APP_SWITCHES>,
    "distractionCount": <COUNT_OF_NON_WORK_ACTIVITIES>,
    "idleScreensDetected": <COUNT_OF_UNCHANGED_OR_ILLEGIBLE_SCREENSHOTS>
  },
  "achievements": ["Only list REAL accomplishments visible in the tiles"],
  "suggestions": ["Specific actionable improvements based on observations"],
  "insights": ["Behavioral patterns noticed - both good and concerning"],
  "concerns": ["Any productivity concerns - be direct and specific"],
  "redFlags": ["List any red flags ACTUALLY VISIBLE: entertainment, idle, etc."],
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
      "summary": "DETAILED description of what is visible in SCREENSHOT 1, with a short verbatim quote of any on-screen text. If the tile is illegible, say so explicitly.",
      "activity": "coding|browsing|meeting|document|communication|design|idle|entertainment|research|unknown",
      "productivity": "high|medium|low|idle",
      "applicationVisible": "Exact app name, or 'unknown' if not legibly identifiable",
      "websiteVisible": "Full domain if legibly visible, otherwise null",
      "isActiveWork": <true_if_evidence_of_active_work_false_otherwise>,
      "concerns": "Any concerns about this specific screenshot",
      "youtubeStatus": "playing|paused|not_applicable"
    }
  ],
  "applications": [
    {
      "name": "Application name (only if visibly identified)",
      "category": "development|communication|productivity|browser|entertainment|utility",
      "estimatedMinutes": <NUMBER>,
      "productivityImpact": "positive|neutral|negative",
      "wasActivelyUsed": <true_or_false>
    }
  ],
  "websites": [
    {
      "domain": "full domain (only if visibly identified)",
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

FINAL REMINDERS:
1. Do NOT give high scores just because work apps are open — require ACTIVE work evidence.
2. Entertainment = automatic score reduction.
3. Same screen multiple times = idle time.
4. Be HONEST — inflated scores don't help anyone improve.
5. The "score" MUST reflect ACTUAL observed productivity, not potential.
6. NEVER name an app, website or task you cannot actually see in the tiles.`;
}

/**
 * Run AI vision analysis over a SINGLE pre-built stitched composite image.
 * The composite already contains every captured screenshot for the day in a
 * fixed grid; we just hand it to the model in one call alongside per-tile
 * geometry + timestamp metadata.
 *
 * @param {Object} args
 * @param {Buffer} args.compositeBuffer
 * @param {String} args.mimeType
 * @param {Array<Object>} args.tiles  Tile records { index, capturedAt }
 * @param {Number} args.columns
 * @param {Number} args.rows
 * @param {Number} args.tileWidth
 * @param {Number} args.tileHeight
 * @param {Number} args.gap
 * @param {Object} args.context  Same context shape as analyzeScreenshotBatch.
 * @param {String|null} args.previousAnalysisSummary
 */
export async function analyzeStitchedComposite({
  compositeBuffer,
  mimeType = 'image/webp',
  tiles,
  columns,
  rows,
  tileWidth,
  tileHeight,
  gap = 0,
  context,
  previousAnalysisSummary = null,
}) {
  if (!compositeBuffer || !compositeBuffer.length) {
    throw new Error('analyzeStitchedComposite: missing composite buffer');
  }
  if (!Array.isArray(tiles) || tiles.length === 0) {
    throw new Error('analyzeStitchedComposite: tiles array is required');
  }

  const sortedTiles = [...tiles].sort((a, b) => a.index - b.index);

  const prompt = buildStitchedAnalysisPrompt({
    employeeName: context.employeeName,
    employeeDesignation: context.employeeDesignation,
    employeeDepartment: context.employeeDepartment,
    employeeRole: context.employeeRole,
    kris: context.kris || [],
    kpis: context.kpis || [],
    taskContextStr: context.taskContextStr || 'No active tasks assigned',
    dateString: context.dateString,
    tiles: sortedTiles,
    columns,
    rows,
    tileWidth,
    tileHeight,
    gap,
    previousAnalysisSummary,
  });

  const responseText = await generateStitchedVisionContent(prompt, {
    buffer: compositeBuffer,
    mimeType,
    filename: `composite-${context.dateString || 'day'}.webp`,
  });

  if (!responseText || !responseText.trim()) {
    throw new Error('Empty AI response for stitched composite analysis');
  }

  return parseProductivityAnalysisResponse(responseText);
}
