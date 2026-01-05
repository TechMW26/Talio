import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import { getTenantModels } from '@/lib/tenantModels';
import { readFile } from 'fs/promises';
import path from 'path';
import { generateVisionContent, generateContent } from '@/lib/gemini';
import { bulkDeleteFromImageKit } from '@/lib/imagekit';

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
    const auth = await getAuthAndModels(request, ['ProductivitySession', 'User'])
    if (!auth.success) {
      console.log(`[ProductivityAnalysis] Auth failed: ${auth.message}`);
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { ProductivitySession, User } = models

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
          
          // Collect ImageKit file IDs from session screenshots
          const imagekitFileIds = [];
          const screenshots = session.screenshots || [];
          
          for (const screenshot of screenshots) {
            if (screenshot.fileId) {
              imagekitFileIds.push(screenshot.fileId);
            }
            if (screenshot.imagekitFileId) {
              imagekitFileIds.push(screenshot.imagekitFileId);
            }
          }
          
          // Delete from ImageKit (bulk delete)
          if (imagekitFileIds.length > 0) {
            console.log(`[ProductivityAnalysis] Deleting ${imagekitFileIds.length} images from ImageKit...`);
            try {
              await bulkDeleteFromImageKit(imagekitFileIds);
              console.log(`[ProductivityAnalysis] Successfully deleted images from ImageKit`);
            } catch (imagekitError) {
              console.error(`[ProductivityAnalysis] ImageKit deletion failed:`, imagekitError.message);
            }
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
          
          if (imagekitFileIds.length > 0) {
            deleteQuery.$or = [
              { imagekitFileId: { $in: imagekitFileIds } },
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
    if (sessionUserId) {
      const userRecord = await User.findById(sessionUserId).populate('employeeId');
      if (userRecord?.employeeId) {
        employeeName = `${userRecord.employeeId.firstName} ${userRecord.employeeId.lastName}`;
      }
    } else if (sessionEmployeeId) {
      const { Employee } = await getTenantModels(auth.tenant.databaseName, ['Employee']);
      const employee = await Employee.findById(sessionEmployeeId);
      if (employee) {
        employeeName = `${employee.firstName} ${employee.lastName}`;
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
    
    // Load images - handle both ImageKit URLs and local filesystem paths
    const images = [];
    const screenshotSummaries = [];
    
    for (const screenshot of selectedScreenshots) {
      try {
        let base64;
        let mimeType = 'image/jpeg'; // Default
        // Support both url and path fields
        const screenshotUrl = screenshot.url || screenshot.path || screenshot.imagekitUrl;
        
        if (!screenshotUrl) {
          console.warn(`[ProductivityAnalysis] Screenshot missing url/path:`, screenshot);
          continue;
        }
        
        // Check if it's a URL (ImageKit) or filesystem path
        if (screenshotUrl.startsWith('http://') || screenshotUrl.startsWith('https://')) {
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
    
    // Build analysis prompt with comprehensive KPIs
    // IMPORTANT: Emphasize this is workplace productivity analysis, not facial recognition
    const analysisPrompt = `You are an expert workplace productivity analyst. Your task is to analyze computer desktop screenshots to assess work activities and productivity metrics.

IMPORTANT CONTEXT:
- These are DESKTOP/SCREEN captures showing applications, websites, and work activities
- You are analyzing SOFTWARE USAGE and WORK PATTERNS, not people
- Focus ONLY on: applications open, websites visited, documents being worked on, code being written, etc.
- Do NOT attempt to identify any individuals - focus purely on the digital work content visible on screen

SESSION CONTEXT:
- Employee Name: ${employeeName}
- Date: ${session.date.toISOString().split('T')[0]}
- Time: ${session.startTime.toLocaleTimeString()} - ${session.endTime.toLocaleTimeString()}
- Duration: ${sessionDurationMinutes} minutes (${sessionDurationHours} hours)
- Total Screenshots: ${screenshots.length}
- Screenshots Being Analyzed: ${images.length}

ANALYSIS INSTRUCTIONS:
1. Examine EACH screenshot to identify visible applications and websites
2. Look for: code editors, browsers, documents, spreadsheets, chat apps, etc.
3. Classify each screenshot's productivity level based on the work activities visible
4. Calculate the score based on ACTUAL observed software/activities, NOT a default value
5. Be specific about what applications and tasks are visible

SCORING GUIDELINES (calculate based on observations):
- 90-100: Exceptional focus - deep work, no distractions, high-value tasks
- 75-89: Very productive - mostly focused work with minimal breaks
- 60-74: Good productivity - solid work with some context switching
- 45-59: Moderate - mix of work and non-work activities
- 30-44: Below average - significant time on non-work activities
- 0-29: Low productivity - mostly idle or non-work activities

RESPOND WITH ONLY THIS JSON (no markdown, no code blocks):

{
  "sessionTitle": "<SHORT_2_TO_4_WORD_NAME_FOR_SESSION_e.g._Frontend_Development_or_Code_Review_or_Documentation_Work>",
  "summary": "Detailed 2-3 paragraph analysis of what the employee worked on, specific tasks observed, and overall productivity assessment",
  "score": <CALCULATED_NUMBER_0_TO_100_BASED_ON_ACTUAL_ANALYSIS>,
  "focusScore": <NUMBER_0_TO_100_HOW_FOCUSED_WERE_THEY>,
  "taskCompletionIndicators": <NUMBER_0_TO_100_EVIDENCE_OF_COMPLETING_TASKS>,
  "timeDistribution": {
    "deepWork": <PERCENTAGE_OF_TIME_IN_FOCUSED_WORK>,
    "collaboration": <PERCENTAGE_IN_MEETINGS_OR_CHAT>,
    "administrative": <PERCENTAGE_ON_EMAIL_DOCS_ETC>,
    "breaks": <PERCENTAGE_IDLE_OR_BREAKS>,
    "unfocused": <PERCENTAGE_ON_DISTRACTING_ACTIVITIES>
  },
  "focusMetrics": {
    "longestFocusStreak": "<ESTIMATED_DURATION_e.g._45_minutes>",
    "contextSwitches": <NUMBER_OF_APP_SWITCHES_OBSERVED>,
    "distractionCount": <NUMBER_OF_NON_WORK_ACTIVITIES>
  },
  "achievements": ["Specific accomplishment 1 observed", "Specific accomplishment 2", "..."],
  "suggestions": ["Specific actionable improvement 1", "Specific improvement 2", "..."],
  "insights": ["Behavioral pattern 1 noticed", "Work habit observation 2", "..."],
  "concerns": ["Any concerning patterns like too many distractions", "Potential burnout signs if any"],
  "workCategories": [
    {"category": "Development/Coding", "percentage": <NUMBER>, "description": "What coding work was observed"},
    {"category": "Communication", "percentage": <NUMBER>, "description": "Email, Slack, meetings"},
    {"category": "Documentation", "percentage": <NUMBER>, "description": "Docs, notes, wiki"},
    {"category": "Research", "percentage": <NUMBER>, "description": "Browsing, reading"},
    {"category": "Other", "percentage": <NUMBER>, "description": "Other activities"}
  ],
  "screenshotAnalysis": [
    {
      "index": 0,
      "timestamp": "<time if visible>",
      "summary": "Detailed description of what's visible in this screenshot",
      "activity": "coding|browsing|meeting|document|communication|design|idle|entertainment|other",
      "productivity": "high|medium|low|idle",
      "applicationVisible": "App name visible",
      "websiteVisible": "Website if browser is open",
      "taskDescription": "What specific task they appear to be doing"
    }
  ],
  "applications": [
    {
      "name": "Application name",
      "category": "development|communication|productivity|browser|entertainment|utility|other",
      "estimatedMinutes": <NUMBER>,
      "productivityImpact": "positive|neutral|negative"
    }
  ],
  "websites": [
    {
      "domain": "website domain if visible",
      "category": "work|research|social|entertainment|other",
      "estimatedMinutes": <NUMBER>
    }
  ],
  "overallAssessment": {
    "strengths": ["What the employee did well"],
    "areasForImprovement": ["Specific areas to improve"],
    "recommendation": "One sentence recommendation for tomorrow"
  }
}

CRITICAL: The "score" MUST be calculated based on what you ACTUALLY observe in the screenshots. Do NOT use a default value. Analyze the activities and calculate an appropriate score.`;

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
      taskCompletionIndicators: analysisResult.taskCompletionIndicators || [],
      timeDistribution: analysisResult.timeDistribution || null,
      focusMetrics: analysisResult.focusMetrics || null,
      concerns: analysisResult.concerns || [],
      workCategories: analysisResult.workCategories || [],
      overallAssessment: analysisResult.overallAssessment || '',
      websites: (analysisResult.websites || []).map(site => ({
        name: site.name || site.url || 'Unknown',
        url: site.url || '',
        estimatedMinutes: site.estimatedMinutes || 0,
        category: site.category || 'other',
        isProductive: site.isProductive !== undefined ? site.isProductive : true
      })),
      applications: (analysisResult.applications || []).map(app => ({
        name: app.name || 'Unknown',
        estimatedMinutes: app.estimatedMinutes || 0,
        category: app.category || 'other',
        isProductive: app.isProductive !== undefined ? app.isProductive : true
      })),
      error: analysisResult.error || null
    };
    
    await session.save();
    
    // ========== CLEANUP: Delete screenshots after successful analysis ==========
    console.log(`[ProductivityAnalysis] Starting cleanup for session ${sessionId}...`);
    
    try {
      // Get Screenshot model for cleanup
      const { Screenshot } = await getTenantModels(auth.tenant.databaseName, ['Screenshot']);
      
      // Collect ImageKit file IDs from session screenshots
      const imagekitFileIds = [];
      const screenshotIds = [];
      
      for (const screenshot of screenshots) {
        // Collect ImageKit file IDs
        if (screenshot.fileId) {
          imagekitFileIds.push(screenshot.fileId);
        }
        if (screenshot.imagekitFileId) {
          imagekitFileIds.push(screenshot.imagekitFileId);
        }
        
        // Collect screenshot document IDs if referenced
        if (screenshot._id) {
          screenshotIds.push(screenshot._id);
        }
      }
      
      // Delete from ImageKit (bulk delete)
      if (imagekitFileIds.length > 0) {
        console.log(`[ProductivityAnalysis] Deleting ${imagekitFileIds.length} images from ImageKit...`);
        try {
          await bulkDeleteFromImageKit(imagekitFileIds);
          console.log(`[ProductivityAnalysis] Successfully deleted images from ImageKit`);
        } catch (imagekitError) {
          console.error(`[ProductivityAnalysis] ImageKit deletion failed:`, imagekitError.message);
          // Don't fail the whole operation if ImageKit deletion fails
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
      
      // If we have specific ImageKit file IDs, also delete by those (as a safety net)
      // But KEEP the time range constraint to avoid deleting from other sessions
      if (imagekitFileIds.length > 0) {
        // Only delete screenshots that EITHER:
        // 1. Match the ImageKit file IDs from this session, OR
        // 2. Fall within this session's time range (for the same user)
        // This is more precise than deleting the whole day
        deleteQuery.$or = [
          { imagekitFileId: { $in: imagekitFileIds } },
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
