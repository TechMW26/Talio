import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import { getTenantModels } from '@/lib/tenantModels';
import { readFile, unlink, rmdir } from 'fs/promises';
import path from 'path';
import { generateVisionContent, generateContent } from '@/lib/gemini';

import { deleteScreenshots as deleteGridFSScreenshots } from '@/lib/gridfs';

const MAX_IMAGES_PER_ANALYSIS = 10; // Limit images to avoid API limits

/**
 * POST /api/productivity/sessions/[id]/analyze
 * Analyze session screenshots with AI
 */
export async function POST(request, { params }) {
  try {
    const { id: sessionId } = await params;

    console.log(`[ProductivityAnalysis] Starting analysis for session: ${sessionId}`);

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['ProductivitySession', 'User', 'Task', 'TaskAssignee', 'Project'])
    if (!auth.success) {
      console.log(`[ProductivityAnalysis] Auth failed: ${auth.message}`);
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { ProductivitySession, User, Task, TaskAssignee, Project } = models

    const currentUserId = user._id || user.userId;
    const currentUserRole = user.role;

    console.log(`[ProductivityAnalysis] User: ${currentUserId}, Role: ${currentUserRole}`);

    // Get session
    const session = await ProductivitySession.findById(sessionId);
    if (!session) {
      console.log(`[ProductivityAnalysis] Session not found: ${sessionId}`);
      return NextResponse.json(
        { success: false, error: 'Session not found' },
        { status: 404 }
      );
    }

    // Get session owner - could be stored as 'user' or 'employee'
    const sessionUserId = session.user?.toString();
    const sessionEmployeeId = session.employee?.toString();

    console.log(`[ProductivityAnalysis] Session found. User: ${sessionUserId}, Employee: ${sessionEmployeeId}, Screenshots: ${session.screenshots?.length || 0}`);

    // Permission check - be more lenient for department heads
    // Check ownership by user ID or by employee ID
    let isOwner = false;
    if (sessionUserId) {
      isOwner = sessionUserId === currentUserId?.toString();
    }
    if (!isOwner && sessionEmployeeId && user.employeeId) {
      const currentEmployeeId = user.employeeId._id?.toString() || user.employeeId?.toString();
      isOwner = sessionEmployeeId === currentEmployeeId;
    }

    const isAdminOrHR = ['admin', 'hr', 'manager', 'department_head'].includes(currentUserRole);
    const isDepartmentHead = user.isDepartmentHead === true;

    console.log(`[ProductivityAnalysis] Permission check - Owner: ${isOwner}, AdminHR: ${isAdminOrHR}, DeptHead: ${isDepartmentHead}`);

    if (!isOwner && !isAdminOrHR && !isDepartmentHead) {
      return NextResponse.json(
        { success: false, error: 'Permission denied' },
        { status: 403 }
      );
    }

    // Check if already analyzed
    if (session.analysis?.isAnalyzed) {
      // Check if screenshots need cleanup (analyzed but not deleted)
      if (!session.screenshotsDeleted && session.screenshots?.length > 0) {
        console.log(`[ProductivityAnalysis] Session ${sessionId} already analyzed but screenshots not cleaned up. Running cleanup...`);

        try {
          // Get Screenshot model for cleanup
          const { Screenshot } = await getTenantModels(auth.tenant.databaseName, ['Screenshot']);

          // Query Screenshot DB for cleanup data (gridfsFileId, path)
          const gridfsFileIds = [];
          const filesystemPaths = [];

          try {
            const dbLookupQuery = { capturedAt: { $gte: session.startTime, $lte: session.endTime } };
            if (session.user) dbLookupQuery.user = session.user;
            else if (session.employee) dbLookupQuery.employee = session.employee;

            const dbScreenshotsLookup = await Screenshot.find(dbLookupQuery)
              .select('gridfsFileId path')
              .lean();

            for (const ss of dbScreenshotsLookup) {
              if (ss.gridfsFileId) {
                gridfsFileIds.push(ss.gridfsFileId);
              }
              if (ss.path && !ss.path.startsWith('http')) {
                filesystemPaths.push(ss.path);
              }
            }
          } catch (lookupErr) {
            console.error(`[ProductivityAnalysis] DB lookup error:`, lookupErr.message);
          }

          // Delete GridFS files
          if (gridfsFileIds.length > 0) {
            try {
              const gridfsResult = await deleteGridFSScreenshots(gridfsFileIds);
              console.log(`[ProductivityAnalysis] GridFS cleanup: ${gridfsResult.successCount}/${gridfsFileIds.length} deleted`);
            } catch (gridfsErr) {
              console.error(`[ProductivityAnalysis] GridFS deletion failed:`, gridfsErr.message);
            }
          }

          // Delete local filesystem files
          if (filesystemPaths.length > 0) {
            let fsDeleteCount = 0;
            for (const fsPath of filesystemPaths) {
              try {
                await unlink(path.join(process.cwd(), 'public', fsPath));
                fsDeleteCount++;
              } catch (err) {
                if (err.code !== 'ENOENT') {
                  console.warn(`[ProductivityAnalysis] Failed to delete file ${fsPath}:`, err.message);
                }
              }
            }
            console.log(`[ProductivityAnalysis] Filesystem cleanup: ${fsDeleteCount}/${filesystemPaths.length} deleted`);
          }

          // Delete raw captures from Screenshot collection
          const deleteQuery = {
            capturedAt: { $gte: session.startTime, $lte: session.endTime }
          };

          if (session.user) {
            deleteQuery.user = session.user;
          } else if (session.employee) {
            deleteQuery.employee = session.employee;
          }

          if (gridfsFileIds.length > 0) {
            deleteQuery.$or = [
              { gridfsFileId: { $in: gridfsFileIds } },
              { capturedAt: { $gte: session.startTime, $lte: session.endTime } }
            ];
            delete deleteQuery.capturedAt;
          }

          const deleteResult = await Screenshot.deleteMany(deleteQuery);
          console.log(`[ProductivityAnalysis] Deleted ${deleteResult.deletedCount} raw captures from Screenshot collection`);

          // Store original count and mark as deleted
          const originalScreenshotCount = session.screenshots?.length || 0;
          session.screenshots = session.screenshots.map((s, index) => ({
            deletedAt: new Date(),
            originalUrl: s.url || s.path,
            capturedAt: s.capturedAt || s.timestamp,
            index: index
          }));
          session.screenshotCount = originalScreenshotCount;
          session.screenshotsDeleted = true;
          session.screenshotsDeletedAt = new Date();
          await session.save();

          console.log(`[ProductivityAnalysis] Cleanup complete for previously analyzed session ${sessionId}`);

          // Re-fetch to get updated data
          const updatedSession = await ProductivitySession.findById(sessionId).lean();
          if (updatedSession && updatedSession._id) {
            updatedSession._id = updatedSession._id.toString();
          }

          return NextResponse.json({
            success: true,
            message: 'Session already analyzed, screenshots cleaned up',
            data: updatedSession
          });

        } catch (cleanupError) {
          console.error(`[ProductivityAnalysis] Cleanup error:`, cleanupError.message);
        }
      }

      return NextResponse.json({
        success: true,
        message: 'Session already analyzed',
        data: session
      });
    }

    // Get user info for context - try user first, then employee
    let employeeName = 'Employee';
    let employeeRole = 'Employee';
    let employeeDesignation = '';
    let employeeDepartment = '';
    let employeeId = null;

    if (sessionUserId) {
      const userRecord = await User.findById(sessionUserId).populate({
        path: 'employeeId',
        populate: { path: 'department', select: 'name' }
      });
      if (userRecord?.employeeId) {
        employeeName = `${userRecord.employeeId.firstName} ${userRecord.employeeId.lastName}`;
        employeeDesignation = userRecord.employeeId.designation || userRecord.employeeId.jobTitle || '';
        employeeDepartment = userRecord.employeeId.department?.name || '';
        employeeId = userRecord.employeeId._id;
      }
      if (userRecord?.role) {
        employeeRole = userRecord.role;
      }
    } else if (sessionEmployeeId) {
      const { Employee, Department } = await getTenantModels(auth.tenant.databaseName, ['Employee', 'Department']);
      const employee = await Employee.findById(sessionEmployeeId).populate('department', 'name');
      if (employee) {
        employeeName = `${employee.firstName} ${employee.lastName}`;
        employeeDesignation = employee.designation || employee.jobTitle || '';
        employeeDepartment = employee.department?.name || '';
        employeeId = employee._id;
      }
    }

    // Fetch user's ongoing tasks for context
    let ongoingTasks = [];
    let taskContextStr = 'No active tasks assigned';

    if (employeeId) {
      try {
        // Get task assignments for this employee
        const taskAssignments = await TaskAssignee.find({
          user: employeeId,
          assignmentStatus: { $in: ['pending', 'accepted'] }
        }).select('task').lean();

        const taskIds = taskAssignments.map(ta => ta.task);

        if (taskIds.length > 0) {
          // Fetch actual tasks that are in progress or todo
          const tasks = await Task.find({
            _id: { $in: taskIds },
            status: { $in: ['todo', 'in-progress', 'review'] }
          })
            .populate('project', 'name')
            .select('title description status priority dueDate project tags')
            .sort({ priority: -1, dueDate: 1 })
            .limit(10)
            .lean();

          ongoingTasks = tasks;

          if (tasks.length > 0) {
            taskContextStr = tasks.map((task, idx) => {
              const projectName = task.project?.name || 'No Project';
              const dueDate = task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'No due date';
              const tags = task.tags?.length > 0 ? task.tags.join(', ') : '';
              return `${idx + 1}. [${task.status.toUpperCase()}] "${task.title}" (Project: ${projectName}, Priority: ${task.priority}, Due: ${dueDate})${tags ? ` [Tags: ${tags}]` : ''}`;
            }).join('\n');
          }
        }

        console.log(`[ProductivityAnalysis] Found ${ongoingTasks.length} ongoing tasks for employee ${employeeId}`);
      } catch (taskError) {
        console.error(`[ProductivityAnalysis] Error fetching tasks:`, taskError.message);
      }
    }

    // Prepare images for analysis
    const screenshots = session.screenshots || [];
    if (screenshots.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No screenshots in session' },
        { status: 400 }
      );
    }

    // Select screenshots evenly distributed across the session
    const selectedIndices = selectEvenlyDistributed(screenshots.length, MAX_IMAGES_PER_ANALYSIS);
    const selectedScreenshots = selectedIndices.map(i => screenshots[i]);

    // Load images - handle both URLs and local filesystem paths
    const images = [];
    const screenshotSummaries = [];

    for (const screenshot of selectedScreenshots) {
      try {
        let base64;
        let mimeType = 'image/jpeg'; // Default
        // Support both url and path fields
        const screenshotUrl = screenshot.url || screenshot.path;

        if (!screenshotUrl) {
          console.warn(`[ProductivityAnalysis] Screenshot missing url/path:`, screenshot);
          continue;
        }

        // Check if it's a URL or filesystem path
        if (screenshotUrl.startsWith('http://') || screenshotUrl.startsWith('https://') || screenshotUrl.startsWith('/api/')) {
          // Fetch image from URL
          console.log(`[ProductivityAnalysis] Fetching image from URL: ${screenshotUrl}`);
          const response = await fetch(screenshotUrl);
          if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.status}`);
          }
          const arrayBuffer = await response.arrayBuffer();
          base64 = Buffer.from(arrayBuffer).toString('base64');

          // Determine mime type from URL or content-type header
          const contentType = response.headers.get('content-type');
          if (contentType) {
            mimeType = contentType.split(';')[0];
          } else if (screenshotUrl.endsWith('.webp')) {
            mimeType = 'image/webp';
          } else if (screenshotUrl.endsWith('.png')) {
            mimeType = 'image/png';
          }
        } else if (screenshotUrl) {
          // Load from filesystem (legacy)
          const imagePath = path.join(process.cwd(), 'public', screenshotUrl);
          const imageBuffer = await readFile(imagePath);
          base64 = imageBuffer.toString('base64');
          mimeType = screenshotUrl.endsWith('.webp') ? 'image/webp' : 'image/png';
        } else {
          throw new Error('No valid screenshot URL or path');
        }

        images.push({
          mimeType,
          data: base64
        });

        screenshotSummaries.push({
          screenshotPath: screenshotUrl,
          timestamp: screenshot.capturedAt || screenshot.timestamp,
          summary: '',
          activity: '',
          productivity: ''
        });
      } catch (error) {
        console.error(`Failed to load image ${screenshot.url || screenshot.path}:`, error.message);
      }
    }

    if (images.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Failed to load screenshots. Images may not be accessible.' },
        { status: 500 }
      );
    }

    // Calculate session duration for context
    const sessionDurationMs = new Date(session.endTime) - new Date(session.startTime);
    const sessionDurationMinutes = Math.round(sessionDurationMs / (1000 * 60));
    const sessionDurationHours = (sessionDurationMinutes / 60).toFixed(1);

    // Build role context for better analysis - DESIGNATION is PRIMARY, department is fallback
    // Designation tells us WHAT the employee does (Developer, Designer, HR Manager)
    // Department only tells us WHERE they work (Engineering, Marketing) - less useful for work analysis
    let primaryRoleContext = '';
    let fallbackContext = '';

    if (employeeDesignation) {
      primaryRoleContext = `Designation/Job Title: ${employeeDesignation}`;
    }
    if (employeeDepartment && !employeeDesignation) {
      // Only use department as fallback if no designation
      fallbackContext = `Department: ${employeeDepartment} (Note: No specific job title available, infer expected work from department)`;
    }
    if (employeeRole && employeeRole !== 'employee') {
      fallbackContext += fallbackContext ? `\n- System Role: ${employeeRole}` : `System Role: ${employeeRole}`;
    }

    const roleContextStr = primaryRoleContext || fallbackContext || 'Not specified - evaluate based on observed activities';

    // Build analysis prompt with comprehensive KPIs
    // IMPORTANT: Emphasize this is workplace productivity analysis, not facial recognition
    const analysisPrompt = `You are a STRICT and PRECISE workplace productivity analyst. Your task is to analyze computer desktop screenshots to assess ACTUAL work activities and productivity metrics.

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
- ${roleContextStr}

IMPORTANT: The employee's DESIGNATION/JOB TITLE is the PRIMARY indicator of expected work type.
- A "Software Developer" should be coding, not doing HR work
- A "Graphic Designer" should be designing, not doing accounting
- Use the designation to judge if activities are role-appropriate
- Department name alone is NOT enough to determine expected work (e.g., "Engineering" dept could have developers, QA, DevOps, managers)

ASSIGNED TASKS (Current workload - use this to determine if work is task-related):
${taskContextStr}

TASK RELATIVITY ANALYSIS:
- Check if the visible work MATCHES any of the assigned tasks above
- A developer working on code related to their task = HIGH task relativity
- Someone browsing unrelated content when they have urgent tasks = LOW task relativity
- Research that clearly supports an assigned task = TASK-RELATED
- If no assigned tasks, evaluate based on role-appropriate work

ROLE-SPECIFIC EXPECTATIONS (match based on DESIGNATION, not department):
- Developers/Engineers: Active coding (cursor in editor, code visible), terminal commands, documentation lookup
- Designers: Active design work in Figma/Photoshop, not just viewing
- Marketing: Campaign management, analytics review, content creation - NOT just social media browsing
- HR/Admin: Document editing, spreadsheet work, email composition (not just reading)
- Sales: CRM updates, email composition, call preparation - NOT general browsing
- QA/Testers: Testing tools, bug tracking, test case management
- Project Managers: Project management tools, documentation, team communication
- Data Analysts: Spreadsheets, analytics dashboards, data visualization tools

SESSION CONTEXT:
- Date: ${session.date.toISOString().split('T')[0]}
- Time: ${session.startTime.toLocaleTimeString()} - ${session.endTime.toLocaleTimeString()}
- Duration: ${sessionDurationMinutes} minutes (${sessionDurationHours} hours)
- Total Screenshots: ${screenshots.length}
- Screenshots Being Analyzed: ${images.length}

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

{
  "sessionTitle": "<SHORT_2_TO_4_WORD_NAME_FOR_SESSION>",
  "summary": "Detailed 2-3 paragraph analysis. Be SPECIFIC about what was observed. Note any concerns about productivity patterns. Mention specific apps/sites seen.",
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

    let analysisResult;

    try {
      console.log(`[ProductivityAnalysis] Analyzing session ${sessionId} with ${images.length} images...`);

      const responseText = await generateVisionContent(analysisPrompt, images);

      console.log(`[ProductivityAnalysis] Raw AI response length: ${responseText?.length || 0}`);
      console.log(`[ProductivityAnalysis] Raw AI response (first 500 chars):`, responseText?.substring(0, 500));

      if (!responseText || responseText.trim().length === 0) {
        throw new Error('Empty response from AI');
      }

      // Parse JSON from response - handle markdown code blocks
      let jsonText = responseText.trim();

      // Remove markdown code block wrappers if present
      const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        jsonText = codeBlockMatch[1].trim();
        console.log(`[ProductivityAnalysis] Extracted JSON from markdown code block`);
      }

      // Try to parse the entire response as JSON first
      try {
        analysisResult = JSON.parse(jsonText);
        console.log(`[ProductivityAnalysis] Direct JSON parse succeeded`);
      } catch (directParseError) {
        console.log(`[ProductivityAnalysis] Direct parse failed, trying to fix truncated JSON...`);

        // Find JSON object using regex
        let jsonMatch = jsonText.match(/\{[\s\S]*\}/);

        if (jsonMatch) {
          let jsonCandidate = jsonMatch[0];

          // Try to fix truncated JSON by closing unclosed structures
          try {
            analysisResult = JSON.parse(jsonCandidate);
            console.log(`[ProductivityAnalysis] Regex JSON parse succeeded`);
          } catch (parseError) {
            console.log(`[ProductivityAnalysis] JSON appears truncated, attempting repair...`);

            // Count unclosed brackets/braces
            let openBraces = (jsonCandidate.match(/\{/g) || []).length;
            let closeBraces = (jsonCandidate.match(/\}/g) || []).length;
            let openBrackets = (jsonCandidate.match(/\[/g) || []).length;
            let closeBrackets = (jsonCandidate.match(/\]/g) || []).length;

            // Try to extract key fields even from truncated JSON
            const summaryMatch = jsonCandidate.match(/"summary"\s*:\s*"([^"]+(?:\\.[^"]*)*?)"/);
            const scoreMatch = jsonCandidate.match(/"score"\s*:\s*(\d+)/);
            const focusScoreMatch = jsonCandidate.match(/"focusScore"\s*:\s*(\d+)/);
            const achievementsMatch = jsonCandidate.match(/"achievements"\s*:\s*\[(.*?)\]/s);
            const suggestionsMatch = jsonCandidate.match(/"suggestions"\s*:\s*\[(.*?)\]/s);
            const insightsMatch = jsonCandidate.match(/"insights"\s*:\s*\[(.*?)\]/s);

            if (summaryMatch && scoreMatch) {
              // Build a valid JSON from extracted fields
              console.log(`[ProductivityAnalysis] Extracting key fields from truncated response`);

              const parseArrayField = (match) => {
                if (!match) return [];
                try {
                  const arrContent = match[1].trim();
                  if (!arrContent) return [];
                  // Try to parse the array content
                  const parsed = JSON.parse(`[${arrContent}]`);
                  return Array.isArray(parsed) ? parsed : [];
                } catch {
                  // Extract strings manually
                  const strings = match[1].match(/"([^"]+)"/g);
                  return strings ? strings.map(s => s.replace(/"/g, '')) : [];
                }
              };

              analysisResult = {
                summary: summaryMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n'),
                score: parseInt(scoreMatch[1], 10),
                focusScore: focusScoreMatch ? parseInt(focusScoreMatch[1], 10) : null,
                achievements: parseArrayField(achievementsMatch),
                suggestions: parseArrayField(suggestionsMatch),
                insights: parseArrayField(insightsMatch),
                _repaired: true
              };
              console.log(`[ProductivityAnalysis] Repaired JSON with score: ${analysisResult.score}`);
            } else {
              console.error(`[ProductivityAnalysis] Cannot repair JSON:`, parseError.message);
              console.log(`[ProductivityAnalysis] Truncated at:`, jsonCandidate.substring(jsonCandidate.length - 200));
              throw new Error('Invalid JSON in AI response: ' + parseError.message);
            }
          }
        } else {
          console.error(`[ProductivityAnalysis] No JSON object found in response`);
          console.log(`[ProductivityAnalysis] Full response:`, jsonText.substring(0, 1000));

          // Check if this is a policy/refusal response from the AI
          const lowerResponse = jsonText.toLowerCase();
          const isRefusal = lowerResponse.includes('unable to') ||
            lowerResponse.includes('cannot analyze') ||
            lowerResponse.includes('cannot process') ||
            lowerResponse.includes('cannot identify') ||
            lowerResponse.includes("can't analyze") ||
            lowerResponse.includes("i'm sorry") ||
            lowerResponse.includes('policy');

          if (isRefusal) {
            console.log(`[ProductivityAnalysis] AI refused to analyze - likely content policy issue`);
            throw new Error('AI_POLICY_REFUSAL: The AI service could not process these images. This may be due to content policies. Please try again or contact support.');
          }

          throw new Error('Invalid AI response format - no JSON found');
        }
      }

      // Validate required fields
      if (typeof analysisResult.score !== 'number' || analysisResult.score < 0 || analysisResult.score > 100) {
        console.warn(`[ProductivityAnalysis] Score is invalid:`, analysisResult.score);
        // Try to estimate from summary keywords
        const summary = (analysisResult.summary || '').toLowerCase();
        if (summary.includes('highly productive') || summary.includes('excellent') || summary.includes('exceptional')) {
          analysisResult.score = 85;
        } else if (summary.includes('productive') || summary.includes('good') || summary.includes('focused')) {
          analysisResult.score = 70;
        } else if (summary.includes('moderate') || summary.includes('average')) {
          analysisResult.score = 55;
        } else {
          analysisResult.score = 60; // Conservative default
        }
      }

      console.log(`[ProductivityAnalysis] Analysis complete. Score: ${analysisResult.score}, Summary length: ${analysisResult.summary?.length || 0}`);

    } catch (aiError) {
      console.error('[ProductivityAnalysis] AI analysis failed:', aiError.message);

      // Check if this is a policy refusal
      const isPolicyRefusal = aiError.message?.includes('AI_POLICY_REFUSAL');

      // DON'T mark as analyzed if AI completely failed - let user retry
      // Return error response without saving
      return NextResponse.json(
        {
          success: false,
          error: isPolicyRefusal
            ? 'AI could not analyze these screenshots due to content policies. The screenshots may contain content that triggered safety filters. Please try again later.'
            : 'AI analysis failed. Please try again later.',
          details: aiError.message?.replace('AI_POLICY_REFUSAL: ', '') || 'Unknown error',
          retryable: true,
          isPolicyRefusal
        },
        { status: 503 }
      );
    }

    // Only reach here if AI succeeded - update screenshot summaries from analysis
    if (analysisResult.screenshotAnalysis) {
      for (const sa of analysisResult.screenshotAnalysis) {
        if (sa.index !== undefined && screenshotSummaries[sa.index]) {
          screenshotSummaries[sa.index].summary = sa.summary || '';
          screenshotSummaries[sa.index].activity = sa.activity || '';
          screenshotSummaries[sa.index].productivity = sa.productivity || '';
          // Also save website visible data from each screenshot
          if (sa.websiteVisible) {
            screenshotSummaries[sa.index].websiteVisible = sa.websiteVisible;
          }
          if (sa.applicationVisible) {
            screenshotSummaries[sa.index].applicationVisible = sa.applicationVisible;
          }
        }
      }
    }

    // Generate session title from AI or create one from detected apps
    let sessionTitle = analysisResult.sessionTitle || '';
    if (!sessionTitle && analysisResult.applications?.length > 0) {
      // Fallback: use most used app category
      const topApp = analysisResult.applications[0];
      sessionTitle = topApp.name || 'Work Session';
    }
    if (!sessionTitle) {
      sessionTitle = 'Work Session';
    }
    // Store the AI-generated title on the session
    session.sessionTitle = sessionTitle;

    // Update session with analysis - include all new KPI fields
    session.analysis = {
      isAnalyzed: true,
      analyzedAt: new Date(),
      summary: analysisResult.summary || '',
      score: analysisResult.score,
      achievements: analysisResult.achievements || [],
      suggestions: analysisResult.suggestions || [],
      insights: analysisResult.insights || [],
      screenshotSummaries,
      detectedApplications: (analysisResult.applications || []).map(app => ({
        name: app.name,
        duration: app.estimatedMinutes || 0,
        category: app.category || 'other'
      })),
      // New KPI fields
      focusScore: analysisResult.focusScore || null,
      taskCompletionIndicators: analysisResult.taskCompletionIndicators || null,
      timeDistribution: analysisResult.timeDistribution || null,
      focusMetrics: analysisResult.focusMetrics || null,
      concerns: analysisResult.concerns || [],
      redFlags: analysisResult.redFlags || [],
      workCategories: analysisResult.workCategories || [],
      overallAssessment: analysisResult.overallAssessment || null,
      // Map websites from AI analysis (AI uses 'domain' field)
      websites: (analysisResult.websites || []).map(site => ({
        domain: site.domain || site.name || site.url || 'Unknown',
        category: site.category || 'other',
        estimatedMinutes: site.estimatedMinutes || 0,
        wasActivelyViewed: site.wasActivelyViewed !== undefined ? site.wasActivelyViewed : true
      })),
      // Map applications from AI analysis
      applications: (analysisResult.applications || []).map(app => ({
        name: app.name || 'Unknown',
        category: app.category || 'other',
        estimatedMinutes: app.estimatedMinutes || 0,
        productivityImpact: app.productivityImpact || 'neutral',
        wasActivelyUsed: app.wasActivelyUsed !== undefined ? app.wasActivelyUsed : true
      })),
      // Screenshot analysis (detailed per-screenshot breakdown)
      screenshotAnalysis: (analysisResult.screenshotAnalysis || []).map(sa => ({
        index: sa.index,
        summary: sa.summary || '',
        activity: sa.activity || '',
        productivity: sa.productivity || '',
        applicationVisible: sa.applicationVisible || '',
        websiteVisible: sa.websiteVisible || '',
        isActiveWork: sa.isActiveWork || false,
        concerns: sa.concerns || '',
        youtubeStatus: sa.youtubeStatus || 'not_applicable'
      })),
      // Task relativity analysis
      taskRelativity: analysisResult.taskRelativity ? {
        score: analysisResult.taskRelativity.score || null,
        matchedTasks: analysisResult.taskRelativity.matchedTasks || [],
        unrelatedActivities: analysisResult.taskRelativity.unrelatedActivities || [],
        assessment: analysisResult.taskRelativity.assessment || ''
      } : null,
      error: analysisResult.error || null
    };

    // Add taskAlignmentPercentage to overallAssessment if available
    if (session.analysis.overallAssessment && analysisResult.overallAssessment?.taskAlignmentPercentage !== undefined) {
      session.analysis.overallAssessment.taskAlignmentPercentage = analysisResult.overallAssessment.taskAlignmentPercentage;
    }

    await session.save();

    // ========== CLEANUP: Delete screenshots after successful analysis ==========
    console.log(`[ProductivityAnalysis] Starting cleanup for session ${sessionId}...`);

    try {
      // Get Screenshot model for cleanup
      const { Screenshot } = await getTenantModels(auth.tenant.databaseName, ['Screenshot']);

      // Query Screenshot DB records for full cleanup data
      const gridfsFileIds = [];
      const filesystemPaths = [];

      try {
        const dbQuery = { capturedAt: { $gte: session.startTime, $lte: session.endTime } };
        if (session.user) dbQuery.user = session.user;
        else if (session.employee) dbQuery.employee = session.employee;

        const dbScreenshots = await Screenshot.find(dbQuery)
          .select('gridfsFileId path')
          .lean();

        for (const ss of dbScreenshots) {
          if (ss.gridfsFileId) {
            gridfsFileIds.push(ss.gridfsFileId);
          }
          if (ss.path && !ss.path.startsWith('http')) {
            filesystemPaths.push(ss.path);
          }
        }
        console.log(`[ProductivityAnalysis] Found ${dbScreenshots.length} Screenshot DB records — GridFS: ${gridfsFileIds.length}, Filesystem: ${filesystemPaths.length}`);
      } catch (dbLookupError) {
        console.error(`[ProductivityAnalysis] Screenshot DB lookup failed:`, dbLookupError.message);
      }

      // Delete GridFS files
      if (gridfsFileIds.length > 0) {
        console.log(`[ProductivityAnalysis] Deleting ${gridfsFileIds.length} GridFS files...`);
        try {
          const gridfsResult = await deleteGridFSScreenshots(gridfsFileIds);
          console.log(`[ProductivityAnalysis] GridFS cleanup: ${gridfsResult.successCount}/${gridfsFileIds.length} deleted`);
        } catch (gridfsError) {
          console.error(`[ProductivityAnalysis] GridFS deletion failed:`, gridfsError.message);
        }
      }

      // Delete local filesystem files
      if (filesystemPaths.length > 0) {
        console.log(`[ProductivityAnalysis] Deleting ${filesystemPaths.length} local filesystem files...`);
        let fsDeleteCount = 0;
        const parentDirs = new Set();
        for (const fsPath of filesystemPaths) {
          try {
            const fullPath = path.join(process.cwd(), 'public', fsPath);
            await unlink(fullPath);
            fsDeleteCount++;
            parentDirs.add(path.dirname(fullPath));
          } catch (err) {
            if (err.code !== 'ENOENT') {
              console.warn(`[ProductivityAnalysis] Failed to delete file ${fsPath}:`, err.message);
            }
          }
        }
        console.log(`[ProductivityAnalysis] Filesystem cleanup: ${fsDeleteCount}/${filesystemPaths.length} deleted`);

        // Try to clean up empty parent directories
        for (const dir of parentDirs) {
          try {
            await rmdir(dir);
          } catch {
            // Directory not empty or doesn't exist — that's fine
          }
        }
      }

      // Delete raw captures from Screenshot collection
      // CRITICAL: Only delete screenshots for THIS SPECIFIC SESSION, not the whole day!
      // Use the session's exact time range to avoid deleting screenshots from other sessions
      const deleteQuery = {
        capturedAt: {
          $gte: session.startTime,
          $lte: session.endTime
        }
      };

      // Add user/employee filter - REQUIRED to avoid deleting other users' data
      if (session.user) {
        deleteQuery.user = session.user;
      } else if (session.employee) {
        deleteQuery.employee = session.employee;
      }

      // If we have specific GridFS file IDs, also delete by those (as a safety net)
      // But KEEP the time range constraint to avoid deleting from other sessions
      if (gridfsFileIds.length > 0) {
        deleteQuery.$or = [
          { gridfsFileId: { $in: gridfsFileIds } },
          {
            capturedAt: {
              $gte: session.startTime,
              $lte: session.endTime
            }
          }
        ];
        delete deleteQuery.capturedAt; // Remove top-level since we're using $or
      }

      const deleteResult = await Screenshot.deleteMany(deleteQuery);
      console.log(`[ProductivityAnalysis] Deleted ${deleteResult.deletedCount} raw captures from Screenshot collection`);

      // Store the original screenshot count before clearing
      const originalScreenshotCount = session.screenshots?.length || 0;

      // Clear the screenshots array in the session (keep only metadata)
      // Store a summary instead of full screenshot data
      session.screenshots = session.screenshots.map((s, index) => ({
        // Keep minimal reference data
        deletedAt: new Date(),
        originalUrl: s.url || s.path,
        capturedAt: s.capturedAt || s.timestamp,
        index: index
      }));
      session.screenshotCount = originalScreenshotCount; // Preserve original count
      session.screenshotsDeleted = true;
      session.screenshotsDeletedAt = new Date();
      await session.save();

      console.log(`[ProductivityAnalysis] Cleanup complete for session ${sessionId}`);

    } catch (cleanupError) {
      console.error(`[ProductivityAnalysis] Cleanup error (non-fatal):`, cleanupError.message);
      // Don't fail the analysis if cleanup fails
    }
    // ========== END CLEANUP ==========

    // Re-fetch the session to ensure we have the latest data with proper structure
    const updatedSession = await ProductivitySession.findById(sessionId).lean();

    // Convert _id to string for consistent frontend handling
    if (updatedSession && updatedSession._id) {
      updatedSession._id = updatedSession._id.toString();
    }

    console.log(`[ProductivityAnalysis] Session saved. Analysis:`, {
      sessionId: updatedSession?._id,
      isAnalyzed: updatedSession?.analysis?.isAnalyzed,
      score: updatedSession?.analysis?.score,
      summaryLength: updatedSession?.analysis?.summary?.length,
      achievementsCount: updatedSession?.analysis?.achievements?.length,
      suggestionsCount: updatedSession?.analysis?.suggestions?.length,
      insightsCount: updatedSession?.analysis?.insights?.length
    });

    return NextResponse.json({
      success: true,
      message: 'Session analyzed successfully',
      data: updatedSession
    });

  } catch (error) {
    console.error('Analyze session error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to analyze session', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/productivity/sessions/[id]/analyze
 * Get analysis results for a session
 */
export async function GET(request, { params }) {
  try {
    const { id: sessionId } = await params;

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['ProductivitySession'])
    if (!auth.success) {
      return NextResponse.json({ success: false, error: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { ProductivitySession } = models

    const session = await ProductivitySession.findById(sessionId);
    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Session not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        sessionId: session._id,
        isAnalyzed: session.analysis?.isAnalyzed || false,
        analysis: session.analysis || null
      }
    });

  } catch (error) {
    console.error('Get analysis error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get analysis', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * Select evenly distributed indices from an array
 */
function selectEvenlyDistributed(totalCount, maxSelect) {
  if (totalCount <= maxSelect) {
    return Array.from({ length: totalCount }, (_, i) => i);
  }

  const indices = [];
  const step = (totalCount - 1) / (maxSelect - 1);

  for (let i = 0; i < maxSelect; i++) {
    indices.push(Math.round(i * step));
  }

  return indices;
}
