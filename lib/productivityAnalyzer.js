/**
 * AI Productivity Data Analyzer
 * Analyzes app usage, websites, keystrokes and provides comprehensive insights
 */

import { generateSmartContent } from '@/lib/promptEngine';
import { generateContent, generateVisionContent } from '@/lib/gemini';

/**
 * Analyze productivity data and generate AI insights
 * @param {Object} data - ProductivityData document
 * @returns {Object} Analysis results
 */
export async function analyzeProductivityData(data) {
  // Prepare context for AI
  const context = prepareAnalysisContext(data);
  const userId = data.userId ? data.userId.toString() : null;

  // Try Gemini first via promptEngine, then fallback to centralized AI
  try {
    return await analyzeWithGemini(context, data, userId);
  } catch (error) {
    console.error('[ProductivityAnalyzer] Gemini via promptEngine failed, trying fallback AI:', error.message);
  }

  try {
    return await analyzeWithFallbackAI(context, data);
  } catch (error) {
    console.error('[ProductivityAnalyzer] Fallback AI failed:', error.message);
  }

  // Fallback to basic analysis
  return generateBasicAnalysis(data);
}

/**
 * Prepare context from productivity data
 */
function prepareAnalysisContext(data) {
  const totalTime = data.totalActiveTime || 1;
  const productivePercent = Math.round((data.productiveTime / totalTime) * 100);
  const unproductivePercent = Math.round((data.unproductiveTime / totalTime) * 100);

  // Format top apps
  const topAppsStr = (data.topApps || [])
    .slice(0, 5)
    .map(app => `- ${app.appName}: ${formatDuration(app.duration)} (${app.percentage}%)`)
    .join('\n');

  // Format top websites
  const topWebsitesStr = (data.topWebsites || [])
    .slice(0, 5)
    .map(site => `- ${site.domain}: ${formatDuration(site.duration)} (${site.visits} visits)`)
    .join('\n');

  // Keystroke stats
  const keystrokeStr = data.keystrokes?.totalCount
    ? `Total keystrokes: ${data.keystrokes.totalCount}, Average: ${data.keystrokes.averagePerMinute || 0}/min`
    : 'No keystroke data';

  return `
PRODUCTIVITY DATA ANALYSIS REQUEST

Time Period: ${formatDuration(totalTime)}
Productive Time: ${formatDuration(data.productiveTime)} (${productivePercent}%)
Neutral Time: ${formatDuration(data.neutralTime)}
Unproductive Time: ${formatDuration(data.unproductiveTime)} (${unproductivePercent}%)

TOP APPLICATIONS:
${topAppsStr || 'No app data'}

TOP WEBSITES:
${topWebsitesStr || 'No website data'}

ACTIVITY METRICS:
${keystrokeStr}
Mouse clicks: ${data.mouseActivity?.clicks || 0}

CAPTURE TYPE: ${data.isInstantCapture ? 'Instant capture (on-demand)' : 'Periodic capture'}
`.trim();
}

/**
 * Analyze with Gemini API
 */
async function analyzeWithGemini(context, data, userId) {
  const prompt = `You are a productivity analyst AI. Analyze this employee's computer usage data and provide helpful insights.

${context}

Respond with a JSON object (and nothing else) with this exact structure:
{
  "summary": "A 2-3 sentence summary of their work session - be specific about what they were doing",
  "productivityScore": <number 0-100 based on productive vs unproductive time>,
  "focusScore": <number 0-100 based on app switching and focus>,
  "efficiencyScore": <number 0-100 based on keystroke activity and engagement>,
  "insights": ["insight 1", "insight 2", "insight 3"],
  "recommendations": ["actionable recommendation 1", "recommendation 2"],
  "areasOfImprovement": ["area 1", "area 2"],
  "topAchievements": ["achievement based on data"]
}

Be constructive, professional, and encouraging. Focus on practical improvements.`;

  const text = await generateSmartContent(prompt, { userId, feature: 'productivity-analysis' });

  // Extract JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON in Gemini response');
  }

  return JSON.parse(jsonMatch[0]);
}

/**
 * Analyze with the centralized custom AI provider.
 */
async function analyzeWithFallbackAI(context, data) {
  const systemInstruction = 'You are a productivity analyst AI. Analyze employee computer usage data and provide helpful, constructive insights. Always respond with valid JSON only.';

  const prompt = `${context}

Respond with a JSON object:
{
  "summary": "2-3 sentence summary of their work session",
  "productivityScore": <0-100>,
  "focusScore": <0-100>,
  "efficiencyScore": <0-100>,
  "insights": ["insight 1", "insight 2", "insight 3"],
  "recommendations": ["recommendation 1", "recommendation 2"],
  "areasOfImprovement": ["area 1", "area 2"],
  "topAchievements": ["achievement"]
}`;

  const text = await generateContent(prompt, systemInstruction);

  // Extract JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON in AI response');
  }

  return JSON.parse(jsonMatch[0]);
}

/**
 * Generate basic analysis without AI
 */
function generateBasicAnalysis(data) {
  const totalTime = data.totalActiveTime || 1;
  const productivePercent = Math.round((data.productiveTime / totalTime) * 100);

  // Calculate scores based on raw data
  const productivityScore = productivePercent;
  const focusScore = data.topApps?.length <= 5 ? 80 : 60; // Fewer app switches = better focus
  const efficiencyScore = data.keystrokes?.totalCount > 100 ? 70 : 50;

  const insights = [];
  const recommendations = [];
  const areasOfImprovement = [];
  const topAchievements = [];

  // Generate insights based on data
  if (data.topApps?.length > 0) {
    insights.push(`Most used app: ${data.topApps[0].appName} (${data.topApps[0].percentage}% of time)`);
  }

  if (productivePercent >= 70) {
    topAchievements.push('Maintained high productivity with over 70% productive time');
  } else if (productivePercent < 40) {
    areasOfImprovement.push('Increase focus on work-related applications');
  }

  if (data.topWebsites?.length > 0) {
    const productiveSites = data.topWebsites.filter(s =>
      ['github.com', 'stackoverflow.com', 'docs.google.com'].some(d => s.domain?.includes(d))
    );
    if (productiveSites.length > 0) {
      insights.push('Good use of developer and productivity tools');
    }
  }

  if (data.keystrokes?.totalCount > 500) {
    insights.push('High keyboard activity indicating active work');
  }

  // Default recommendations
  if (recommendations.length === 0) {
    recommendations.push('Consider using focus mode or website blockers during deep work');
    recommendations.push('Take short breaks every 90 minutes to maintain productivity');
  }

  return {
    summary: `Active session of ${formatDuration(totalTime)} with ${productivePercent}% productive time. ${data.topApps?.[0]?.appName || 'Various applications'} was the primary focus.`,
    productivityScore,
    focusScore,
    efficiencyScore,
    insights: insights.length > 0 ? insights : ['Session data captured', 'Activity monitoring active'],
    recommendations,
    areasOfImprovement: areasOfImprovement.length > 0 ? areasOfImprovement : ['Data analysis in progress'],
    topAchievements: topAchievements.length > 0 ? topAchievements : ['Consistent activity tracked']
  };
}

/**
 * Format duration in human readable format
 */
function formatDuration(ms) {
  if (!ms || ms < 1000) return '0 min';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes} min`;
}

/**
 * Analyze screenshot for work context (optional enhancement)
 * Uses centralized gemini.js with the custom AI vision provider.
 */
export async function analyzeScreenshot(screenshotBase64) {
  try {
    // Extract base64 data from data URL if needed
    let imageData = screenshotBase64;
    let mimeType = 'image/png';

    if (screenshotBase64.startsWith('data:')) {
      const matches = screenshotBase64.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        mimeType = matches[1];
        imageData = matches[2];
      }
    }

    const prompt = 'Briefly describe what work this person is doing based on their screen. Keep it professional and factual. Also estimate a productivity score 0-100. Respond in JSON: {"summary": "...", "productivityScore": number, "applications": ["app1", "app2"]}';

    const result = await generateVisionContent(prompt, [{ data: imageData, mimeType }]);

    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error('[ScreenshotAnalysis] Error:', error.message);
  }

  return {
    summary: 'Screen captured',
    productivityScore: 50,
    applications: []
  };
}

export default analyzeProductivityData;
