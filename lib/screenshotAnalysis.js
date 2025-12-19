import connectDB from './mongodb.js';
import { generateVisionContent, generateContent } from './gemini.js';
import { getScreenshot, deleteOldScreenshots } from './gridfs.js';
import Screenshot from '@/models/Screenshot';
import ScreenshotAnalysis from '@/models/ScreenshotAnalysis';
import User from '@/models/User';
import Employee from '@/models/Employee';
import Designation from '@/models/Designation';
import Department from '@/models/Department';

// Track last cleanup to prevent multiple runs
let lastCleanupDate = null;
let lastAnalysisDate = null;

/**
 * Check if it's Sunday and after 12 PM (cleanup time)
 */
function isCleanupTime() {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday
  const hour = now.getHours();
  const today = now.toISOString().split('T')[0];
  
  // Already ran today
  if (lastCleanupDate === today) {
    return false;
  }
  
  // Sunday after 12 PM
  return day === 0 && hour >= 12;
}

/**
 * Check if daily analysis should run (once per day, any time after midnight)
 */
function shouldRunDailyAnalysis() {
  const today = new Date().toISOString().split('T')[0];
  
  if (lastAnalysisDate === today) {
    return false;
  }
  
  return true;
}

/**
 * Run screenshot cleanup - delete screenshots older than 7 days
 */
export async function runScreenshotCleanup() {
  const today = new Date().toISOString().split('T')[0];
  
  if (lastCleanupDate === today) {
    console.log('[Cleanup] Already ran today, skipping');
    return { skipped: true };
  }
  
  console.log('[Cleanup] Starting weekly screenshot cleanup...');
  
  try {
    await connectDB();
    
    // Calculate date 7 days ago
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    
    // Get screenshots to delete
    const screenshotsToDelete = await Screenshot.find({
      capturedAt: { $lt: sevenDaysAgo }
    }).select('gridfsFileId');
    
    console.log(`[Cleanup] Found ${screenshotsToDelete.length} screenshots older than 7 days`);
    
    if (screenshotsToDelete.length === 0) {
      lastCleanupDate = today;
      return { deletedCount: 0 };
    }
    
    // Delete from GridFS
    const gridfsResult = await deleteOldScreenshots(sevenDaysAgo);
    
    // Delete metadata documents
    const mongoResult = await Screenshot.deleteMany({
      capturedAt: { $lt: sevenDaysAgo }
    });
    
    lastCleanupDate = today;
    
    console.log(`[Cleanup] Deleted ${mongoResult.deletedCount} screenshot records and ${gridfsResult.deletedCount} GridFS files`);
    
    return {
      deletedCount: mongoResult.deletedCount,
      gridfsDeleted: gridfsResult.deletedCount,
      olderThan: sevenDaysAgo.toISOString()
    };
    
  } catch (error) {
    console.error('[Cleanup] Error:', error);
    throw error;
  }
}

/**
 * Get employee context for AI analysis
 */
async function getEmployeeContext(userId) {
  try {
    const user = await User.findById(userId).select('name email employeeId');
    if (!user) return null;
    
    let employee = null;
    if (user.employeeId) {
      employee = await Employee.findById(user.employeeId)
        .populate('designation', 'title level')
        .populate('department', 'name');
    } else if (user.email) {
      employee = await Employee.findOne({ email: user.email.toLowerCase() })
        .populate('designation', 'title level')
        .populate('department', 'name');
    }
    
    if (!employee) {
      return {
        name: user.name || user.email,
        designation: 'Employee',
        department: 'General',
        expectedWorkflow: 'General office work, communication, and task management'
      };
    }
    
    // Infer expected workflow based on designation
    const designation = employee.designation?.title || 'Employee';
    const department = employee.department?.name || 'General';
    
    let expectedWorkflow = 'General office work';
    const designationLower = designation.toLowerCase();
    
    if (designationLower.includes('developer') || designationLower.includes('engineer')) {
      expectedWorkflow = 'Coding, development tools (IDE, terminal, browser for documentation), code reviews, and technical communication';
    } else if (designationLower.includes('designer')) {
      expectedWorkflow = 'Design tools (Figma, Adobe), prototyping, asset creation, and design reviews';
    } else if (designationLower.includes('manager')) {
      expectedWorkflow = 'Team management, meetings, project planning, reporting, and communication tools';
    } else if (designationLower.includes('sales')) {
      expectedWorkflow = 'CRM software, client communication, proposals, and sales tracking';
    } else if (designationLower.includes('hr') || designationLower.includes('human')) {
      expectedWorkflow = 'HRMS systems, recruitment platforms, employee communication, and documentation';
    } else if (designationLower.includes('account') || designationLower.includes('finance')) {
      expectedWorkflow = 'Accounting software, spreadsheets, financial reports, and invoicing';
    } else if (designationLower.includes('marketing')) {
      expectedWorkflow = 'Marketing tools, social media, analytics, content creation, and campaign management';
    } else if (designationLower.includes('support') || designationLower.includes('service')) {
      expectedWorkflow = 'Support ticketing systems, customer communication, and knowledge base';
    }
    
    return {
      name: `${employee.firstName} ${employee.lastName}`,
      designation,
      department,
      expectedWorkflow
    };
    
  } catch (error) {
    console.error('[AI] Error getting employee context:', error);
    return null;
  }
}

/**
 * Analyze a batch of screenshots using AI
 */
async function analyzeScreenshotBatch(screenshots, employeeContext) {
  if (!screenshots || screenshots.length === 0) {
    return [];
  }
  
  // Limit to 10 screenshots per batch for API limits
  const batch = screenshots.slice(0, 10);
  const analyses = [];
  
  for (const screenshot of batch) {
    try {
      // Get image from GridFS
      const imageBuffer = await getScreenshot(screenshot.gridfsFileId);
      const base64Image = imageBuffer.toString('base64');
      const mimeType = screenshot.metadata?.mimeType || 'image/png';
      
      const prompt = `Analyze this screenshot from an employee's workstation.

Employee Context:
- Name: ${employeeContext?.name || 'Unknown'}
- Designation: ${employeeContext?.designation || 'Employee'}
- Department: ${employeeContext?.department || 'General'}
- Expected Workflow: ${employeeContext?.expectedWorkflow || 'General office work'}

Analyze the screenshot and provide:
1. A brief summary of what the user is doing (1-2 sentences)
2. The main application or website visible
3. Activity category: work, communication, meeting, break, idle, entertainment, research, or other
4. Productivity level: high (focused work), medium (moderate focus), low (distracted), or idle (no activity)
5. Any notable observations

Respond in JSON format:
{
  "summary": "...",
  "application": "...",
  "category": "...",
  "productivity": "...",
  "detectedContent": ["...", "..."],
  "observations": "..."
}`;

      const response = await generateVisionContent(prompt, [{
        mimeType,
        data: base64Image
      }]);
      
      // Parse AI response
      let parsed = {};
      try {
        // Extract JSON from response
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        }
      } catch (e) {
        parsed = {
          summary: response.substring(0, 200),
          application: 'Unknown',
          category: 'other',
          productivity: 'medium',
          detectedContent: [],
          observations: ''
        };
      }
      
      analyses.push({
        screenshotId: screenshot._id,
        capturedAt: screenshot.capturedAt,
        summary: parsed.summary || 'Activity observed',
        activity: parsed.category || 'other',
        productivity: parsed.productivity || 'medium',
        application: parsed.application || 'Unknown',
        detectedContent: parsed.detectedContent || []
      });
      
    } catch (error) {
      console.error(`[AI] Error analyzing screenshot ${screenshot._id}:`, error.message);
      analyses.push({
        screenshotId: screenshot._id,
        capturedAt: screenshot.capturedAt,
        summary: 'Analysis failed',
        activity: 'other',
        productivity: 'medium',
        application: 'Unknown',
        detectedContent: []
      });
    }
  }
  
  return analyses;
}

/**
 * Generate daily summary from screenshot analyses
 */
async function generateDailySummary(analyses, employeeContext, screenshotCount) {
  if (!analyses || analyses.length === 0) {
    return {
      overview: 'No screenshots available for analysis.',
      keyActivities: [],
      achievements: [],
      concerns: [],
      recommendations: []
    };
  }
  
  const prompt = `Based on the following screenshot analyses from an employee's workday, generate a comprehensive daily summary.

Employee Context:
- Name: ${employeeContext?.name || 'Unknown'}
- Designation: ${employeeContext?.designation || 'Employee'}
- Department: ${employeeContext?.department || 'General'}
- Expected Workflow: ${employeeContext?.expectedWorkflow || 'General office work'}

Total Screenshots: ${screenshotCount}
Analyzed Screenshots: ${analyses.length}

Screenshot Analyses:
${analyses.map((a, i) => `
${i + 1}. Time: ${new Date(a.capturedAt).toLocaleTimeString()}
   Summary: ${a.summary}
   Application: ${a.application}
   Category: ${a.activity}
   Productivity: ${a.productivity}
`).join('\n')}

Generate a summary in JSON format:
{
  "overview": "2-3 sentence summary of the day's work",
  "keyActivities": ["Activity 1", "Activity 2", ...],
  "achievements": ["Achievement 1", "Achievement 2", ...],
  "concerns": ["Concern if any", ...],
  "recommendations": ["Recommendation 1", ...]
}`;

  try {
    const response = await generateContent(prompt);
    
    // Parse JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    return {
      overview: response.substring(0, 500),
      keyActivities: [],
      achievements: [],
      concerns: [],
      recommendations: []
    };
    
  } catch (error) {
    console.error('[AI] Error generating summary:', error);
    return {
      overview: 'Summary generation failed.',
      keyActivities: [],
      achievements: [],
      concerns: [],
      recommendations: []
    };
  }
}

/**
 * Generate timeline from analyses
 */
function generateTimeline(analyses) {
  if (!analyses || analyses.length === 0) {
    return [];
  }
  
  // Group consecutive screenshots with same activity
  const timeline = [];
  let currentSegment = null;
  
  for (const analysis of analyses.sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt))) {
    if (!currentSegment || currentSegment.category !== analysis.activity) {
      // Start new segment
      if (currentSegment) {
        currentSegment.endTime = analysis.capturedAt;
        currentSegment.duration = Math.round(
          (new Date(currentSegment.endTime) - new Date(currentSegment.startTime)) / (1000 * 60)
        );
        timeline.push(currentSegment);
      }
      
      currentSegment = {
        startTime: analysis.capturedAt,
        endTime: analysis.capturedAt,
        activity: analysis.summary,
        category: analysis.activity,
        productivity: analysis.productivity,
        applications: [analysis.application],
        description: analysis.summary
      };
    } else {
      // Extend current segment
      currentSegment.endTime = analysis.capturedAt;
      if (!currentSegment.applications.includes(analysis.application)) {
        currentSegment.applications.push(analysis.application);
      }
    }
  }
  
  // Don't forget last segment
  if (currentSegment) {
    currentSegment.duration = Math.max(1, Math.round(
      (new Date(currentSegment.endTime) - new Date(currentSegment.startTime)) / (1000 * 60)
    ));
    timeline.push(currentSegment);
  }
  
  return timeline;
}

/**
 * Calculate productivity metrics
 */
function calculateMetrics(analyses) {
  if (!analyses || analyses.length === 0) {
    return {
      overallScore: 0,
      focusScore: 0,
      activityScore: 0,
      consistencyScore: 0
    };
  }
  
  const productivityScores = {
    high: 100,
    medium: 70,
    low: 40,
    idle: 10
  };
  
  const categoryScores = {
    work: 100,
    research: 90,
    meeting: 85,
    communication: 70,
    other: 50,
    break: 30,
    entertainment: 20,
    idle: 10
  };
  
  let productivitySum = 0;
  let categorySum = 0;
  
  for (const analysis of analyses) {
    productivitySum += productivityScores[analysis.productivity] || 50;
    categorySum += categoryScores[analysis.activity] || 50;
  }
  
  const avgProductivity = productivitySum / analyses.length;
  const avgCategory = categorySum / analyses.length;
  
  // Focus score based on consecutive high productivity
  let maxStreak = 0;
  let currentStreak = 0;
  for (const analysis of analyses) {
    if (analysis.productivity === 'high') {
      currentStreak++;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }
  const focusScore = Math.min(100, (maxStreak / analyses.length) * 200);
  
  // Consistency score based on variance
  const scores = analyses.map(a => productivityScores[a.productivity] || 50);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / scores.length;
  const consistencyScore = Math.max(0, 100 - Math.sqrt(variance));
  
  return {
    overallScore: Math.round((avgProductivity + avgCategory) / 2),
    focusScore: Math.round(focusScore),
    activityScore: Math.round(avgCategory),
    consistencyScore: Math.round(consistencyScore)
  };
}

/**
 * Calculate application usage from analyses
 */
function calculateApplicationUsage(analyses, totalMinutes) {
  const appUsage = {};
  
  for (const analysis of analyses) {
    const app = analysis.application || 'Unknown';
    if (!appUsage[app]) {
      appUsage[app] = {
        name: app,
        count: 0,
        category: analysis.activity
      };
    }
    appUsage[app].count++;
  }
  
  // Convert to array and calculate percentages
  return Object.values(appUsage)
    .map(app => ({
      name: app.name,
      category: app.category,
      duration: Math.round((app.count / analyses.length) * totalMinutes),
      percentage: Math.round((app.count / analyses.length) * 100)
    }))
    .sort((a, b) => b.percentage - a.percentage);
}

/**
 * Calculate category breakdown
 */
function calculateCategoryBreakdown(analyses, totalMinutes) {
  const categoryCount = {};
  
  for (const analysis of analyses) {
    const cat = analysis.activity || 'other';
    categoryCount[cat] = (categoryCount[cat] || 0) + 1;
  }
  
  return Object.entries(categoryCount)
    .map(([category, count]) => ({
      category,
      duration: Math.round((count / analyses.length) * totalMinutes),
      percentage: Math.round((count / analyses.length) * 100)
    }))
    .sort((a, b) => b.percentage - a.percentage);
}

/**
 * Run daily analysis for a specific user and date
 */
export async function analyzeUserDay(userId, dateString) {
  console.log(`[AI] Starting analysis for user ${userId} on ${dateString}`);
  
  try {
    await connectDB();
    
    // Check if analysis already exists
    let analysis = await ScreenshotAnalysis.findOne({ user: userId, dateString });
    
    if (analysis && analysis.status === 'completed') {
      console.log(`[AI] Analysis already completed for ${userId} on ${dateString}`);
      return analysis;
    }
    
    // Get screenshots for the day
    const screenshots = await Screenshot.find({
      user: userId,
      dateString
    }).sort({ capturedAt: 1 });
    
    if (screenshots.length === 0) {
      console.log(`[AI] No screenshots found for ${userId} on ${dateString}`);
      return null;
    }
    
    // Get employee context
    const employeeContext = await getEmployeeContext(userId);
    
    // Get employee ID
    const user = await User.findById(userId).select('employeeId email');
    let employeeId = user?.employeeId;
    if (!employeeId && user?.email) {
      const emp = await Employee.findOne({ email: user.email.toLowerCase() });
      employeeId = emp?._id;
    }
    
    // Create or update analysis record
    if (!analysis) {
      analysis = new ScreenshotAnalysis({
        user: userId,
        employee: employeeId,
        dateString,
        date: new Date(dateString),
        employeeContext,
        screenshotCount: screenshots.length,
        status: 'analyzing'
      });
    } else {
      analysis.status = 'analyzing';
      analysis.screenshotCount = screenshots.length;
    }
    
    await analysis.save();
    
    const startTime = Date.now();
    
    // Analyze screenshots in batches
    const allAnalyses = [];
    const batchSize = 10;
    
    for (let i = 0; i < screenshots.length; i += batchSize) {
      const batch = screenshots.slice(i, i + batchSize);
      const batchAnalyses = await analyzeScreenshotBatch(batch, employeeContext);
      allAnalyses.push(...batchAnalyses);
      
      // Small delay between batches to avoid rate limits
      if (i + batchSize < screenshots.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Calculate time range
    const firstCapture = screenshots[0].capturedAt;
    const lastCapture = screenshots[screenshots.length - 1].capturedAt;
    const totalMinutes = Math.round((new Date(lastCapture) - new Date(firstCapture)) / (1000 * 60));
    
    // Generate timeline
    const timeline = generateTimeline(allAnalyses);
    
    // Generate summary
    const summary = await generateDailySummary(allAnalyses, employeeContext, screenshots.length);
    
    // Calculate metrics
    const metrics = calculateMetrics(allAnalyses);
    
    // Calculate app usage
    const applicationUsage = calculateApplicationUsage(allAnalyses, totalMinutes);
    
    // Calculate category breakdown
    const categoryBreakdown = calculateCategoryBreakdown(allAnalyses, totalMinutes);
    
    // Calculate hourly activity
    const hourlyActivity = [];
    for (let hour = 0; hour < 24; hour++) {
      const hourScreenshots = allAnalyses.filter(a => 
        new Date(a.capturedAt).getHours() === hour
      );
      
      if (hourScreenshots.length > 0) {
        const avgProductivity = hourScreenshots.reduce((acc, a) => {
          const scores = { high: 3, medium: 2, low: 1, idle: 0 };
          return acc + (scores[a.productivity] || 1);
        }, 0) / hourScreenshots.length;
        
        hourlyActivity.push({
          hour,
          screenshotCount: hourScreenshots.length,
          avgProductivity: avgProductivity > 2.5 ? 'high' : avgProductivity > 1.5 ? 'medium' : avgProductivity > 0.5 ? 'low' : 'idle',
          isActive: true
        });
      }
    }
    
    // Update analysis record
    analysis.firstCapture = firstCapture;
    analysis.lastCapture = lastCapture;
    analysis.totalActiveMinutes = totalMinutes;
    analysis.timeline = timeline;
    analysis.summary = summary;
    analysis.metrics = metrics;
    analysis.applicationUsage = applicationUsage;
    analysis.categoryBreakdown = categoryBreakdown;
    analysis.hourlyActivity = hourlyActivity;
    analysis.screenshotAnalyses = allAnalyses;
    analysis.status = 'completed';
    analysis.analyzedAt = new Date();
    analysis.processingTime = Date.now() - startTime;
    analysis.aiModel = 'gemini-with-openai-fallback';
    
    await analysis.save();
    
    console.log(`[AI] Analysis completed for ${userId} on ${dateString} in ${analysis.processingTime}ms`);
    
    return analysis;
    
  } catch (error) {
    console.error(`[AI] Analysis error for ${userId}:`, error);
    
    // Update analysis with error
    try {
      await ScreenshotAnalysis.findOneAndUpdate(
        { user: userId, dateString },
        { status: 'failed', error: error.message }
      );
    } catch (e) {
      console.error('[AI] Failed to update analysis status:', e);
    }
    
    throw error;
  }
}

/**
 * Run daily analysis for all users with screenshots from yesterday
 */
export async function runDailyAnalysis() {
  const today = new Date().toISOString().split('T')[0];
  
  if (!shouldRunDailyAnalysis()) {
    console.log('[AI] Daily analysis already ran today');
    return { skipped: true };
  }
  
  console.log('[AI] Starting daily analysis for all users...');
  
  try {
    await connectDB();
    
    // Get yesterday's date
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayString = yesterday.toISOString().split('T')[0];
    
    // Find all users with screenshots from yesterday
    const userIds = await Screenshot.distinct('user', { dateString: yesterdayString });
    
    console.log(`[AI] Found ${userIds.length} users with screenshots from ${yesterdayString}`);
    
    const results = {
      total: userIds.length,
      completed: 0,
      failed: 0,
      skipped: 0,
      errors: []
    };
    
    for (const userId of userIds) {
      try {
        // Check if already analyzed
        const existing = await ScreenshotAnalysis.findOne({
          user: userId,
          dateString: yesterdayString,
          status: 'completed'
        });
        
        if (existing) {
          results.skipped++;
          continue;
        }
        
        await analyzeUserDay(userId.toString(), yesterdayString);
        results.completed++;
        
        // Small delay between users
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } catch (error) {
        results.failed++;
        results.errors.push({ userId: userId.toString(), error: error.message });
      }
    }
    
    lastAnalysisDate = today;
    
    console.log(`[AI] Daily analysis complete: ${results.completed} completed, ${results.failed} failed, ${results.skipped} skipped`);
    
    return results;
    
  } catch (error) {
    console.error('[AI] Daily analysis error:', error);
    throw error;
  }
}

/**
 * Middleware function to trigger scheduled tasks
 * Call this from frequently-accessed API routes
 */
export async function triggerScheduledTasks() {
  try {
    // Check for Sunday cleanup
    if (isCleanupTime()) {
      console.log('[Scheduler] Triggering Sunday cleanup...');
      await runScreenshotCleanup();
    }
    
    // Check for daily analysis
    if (shouldRunDailyAnalysis()) {
      console.log('[Scheduler] Triggering daily analysis...');
      // Run in background to not block the request
      runDailyAnalysis().catch(err => {
        console.error('[Scheduler] Daily analysis background error:', err);
      });
    }
    
  } catch (error) {
    console.error('[Scheduler] Error:', error);
  }
}

export default {
  runScreenshotCleanup,
  analyzeUserDay,
  runDailyAnalysis,
  triggerScheduledTasks,
  isCleanupTime,
  shouldRunDailyAnalysis
};
