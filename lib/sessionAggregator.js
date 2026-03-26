import connectDB from '@/lib/mongodb';
import mongoose from 'mongoose';
import ProductivityData from '@/models/ProductivityData';
import ProductivitySession from '@/models/ProductivitySession';
import Attendance from '@/models/Attendance';
import Employee from '@/models/Employee';

// SESSION CONFIGURATION
// Each session contains exactly 20 screenshots (1 per 3 minutes)
// Last session of the day is marked by checkout and may have fewer screenshots
const SCREENSHOTS_PER_SESSION = 20;
const SESSION_DURATION_MINS = 60;

/**
 * Helper to safely convert to ObjectId
 */
function toObjectId(id) {
  if (!id) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  if (typeof id === 'string' && mongoose.Types.ObjectId.isValid(id)) {
    return new mongoose.Types.ObjectId(id);
  }
  return id;
}

/**
 * Get start of day for a given date
 */
function getStartOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get end of day for a given date
 */
function getEndOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Get checkout time for a user on a specific date
 * Returns null if no checkout or checkout not yet done
 */
async function getCheckoutTime(userId, date) {
  try {
    // Get employee ID for user
    const employee = await Employee.findOne({ userId: toObjectId(userId) }).select('_id').lean();
    if (!employee) return null;

    const dayStart = getStartOfDay(date);
    const dayEnd = getEndOfDay(date);

    const attendance = await Attendance.findOne({
      employee: employee._id,
      date: { $gte: dayStart, $lte: dayEnd },
      checkOut: { $exists: true, $ne: null }
    }).select('checkOut').lean();

    return attendance?.checkOut || null;
  } catch (error) {
    console.error('[Session Aggregator] Error getting checkout time:', error);
    return null;
  }
}

/**
 * Aggregate raw productivity data into sessions for a user
 * NEW LOGIC: Create sessions of exactly 30 screenshots each
 * - Start from first screenshot of the day
 * - Collect 30 consecutive screenshots into one session
 * - Last session of day ends at checkout (may have < 30 screenshots)
 * 
 * @param {string|ObjectId} userId - The user ID to aggregate data for
 * @param {Date} targetDate - Date to aggregate sessions for (defaults to today)
 * @param {boolean} forceRecompile - If true, delete existing sessions and recompile
 */
export async function aggregateSessionsForUser(userId, targetDate = new Date(), forceRecompile = false) {
  await connectDB();

  const userObjId = toObjectId(userId);
  if (!userObjId) {
    console.log('[Session Aggregator] Invalid userId:', userId);
    return [];
  }

  const dayStart = getStartOfDay(targetDate);
  const dayEnd = getEndOfDay(targetDate);

  console.log('[Session Aggregator] Processing user', userObjId.toString(), 'for date', dayStart.toISOString().split('T')[0]);

  // Get checkout time for this day (if exists)
  const checkoutTime = await getCheckoutTime(userId, targetDate);
  console.log('[Session Aggregator] Checkout time for day:', checkoutTime?.toISOString() || 'Not checked out');

  // If forcing recompile, delete existing sessions for this day
  if (forceRecompile) {
    const deleted = await ProductivitySession.deleteMany({
      userId: userObjId,
      sessionStart: { $gte: dayStart, $lte: dayEnd }
    });
    console.log('[Session Aggregator] Deleted', deleted.deletedCount, 'existing sessions for recompile');
  }

  // Get all raw productivity data for the day, sorted by capture time
  const rawData = await ProductivityData.find({
    userId: userObjId,
    createdAt: { $gte: dayStart, $lte: dayEnd },
    status: { $in: ['synced', 'analyzed'] }
  }).sort({ createdAt: 1 }).lean();

  if (rawData.length === 0) {
    console.log('[Session Aggregator] No data found for user', userObjId.toString());
    return [];
  }

  console.log('[Session Aggregator] Found', rawData.length, 'raw data points');

  // Get the employee ID from first data point
  const employeeId = rawData[0].employeeId;

  // Group data into sessions of 30 screenshots each
  const sessions = [];
  let currentBatch = [];
  let sessionIndex = 0;

  for (let i = 0; i < rawData.length; i++) {
    const data = rawData[i];
    const dataTime = new Date(data.createdAt);
    
    // Check if this data point is after checkout (if checkout exists)
    if (checkoutTime && dataTime > checkoutTime) {
      console.log('[Session Aggregator] Skipping data after checkout:', dataTime.toISOString());
      continue;
    }

    currentBatch.push(data);

    // Check if we have 30 screenshots OR this is the last data point before checkout
    const isLastBeforeCheckout = checkoutTime && 
      (i === rawData.length - 1 || new Date(rawData[i + 1]?.createdAt) > checkoutTime);
    
    if (currentBatch.length === SCREENSHOTS_PER_SESSION || isLastBeforeCheckout) {
      // Create session from current batch
      const sessionStart = new Date(currentBatch[0].createdAt);
      const sessionEnd = new Date(currentBatch[currentBatch.length - 1].createdAt);
      
      const isLastSession = isLastBeforeCheckout && currentBatch.length < SCREENSHOTS_PER_SESSION;
      
      const session = {
        userId: userObjId,
        employeeId,
        sessionStart,
        sessionEnd: isLastSession && checkoutTime ? checkoutTime : sessionEnd,
        sessionDuration: Math.round((sessionEnd - sessionStart) / 60000),
        status: 'completed',
        isLastSessionOfDay: isLastSession,
        checkoutTriggered: isLastSession
      };

      const aggregated = aggregateSessionData(session, currentBatch, sessionIndex);
      sessions.push(aggregated);
      
      console.log('[Session Aggregator] Created session', sessionIndex + 1, ':', currentBatch.length, 'screenshots,', session.sessionDuration, 'mins', isLastSession ? '(LAST SESSION)' : '');
      
      currentBatch = [];
      sessionIndex++;
    }
  }

  // Handle remaining data that didn't complete a full session
  if (currentBatch.length > 0 && !checkoutTime) {
    console.log('[Session Aggregator]', currentBatch.length, 'screenshots pending (waiting for more data or checkout)');
  }

  console.log('[Session Aggregator] Created', sessions.length, 'complete sessions for user', userObjId.toString());
  return sessions;
}

/**
 * Aggregate data points into a single session
 */
function aggregateSessionData(session, dataPoints, sessionIndex) {
  const screenshots = [];
  const appUsageMap = new Map();
  const websiteUsageMap = new Map();
  let totalKeystrokes = 0;
  let totalMouseClicks = 0;
  let totalScrollDistance = 0;
  let totalMovementDistance = 0;
  let totalActiveTime = 0;
  let productiveTime = 0;
  let neutralTime = 0;
  let unproductiveTime = 0;

  for (const data of dataPoints) {
    // Add screenshot if present (check for path first for file-based storage)
    if (data.screenshot?.path || data.screenshot?.data || data.screenshot?.url) {
      screenshots.push({
        capturedAt: data.screenshot.capturedAt || data.createdAt || data.periodStart,
        path: data.screenshot.path, // File path for file-based storage
        thumbnail: data.screenshot.path || data.screenshot.thumbnail || data.screenshot.data || data.screenshot.url,
        fullData: data.screenshot.path || data.screenshot.data || data.screenshot.url,
        captureType: data.screenshot.captureType || 'periodic',
        linkedDataId: data._id
      });
    }

    // Aggregate app usage
    if (data.appUsage && Array.isArray(data.appUsage)) {
      for (const app of data.appUsage) {
        const appName = app.appName || 'Unknown';
        const existing = appUsageMap.get(appName) || { 
          duration: 0, 
          count: 0,
          category: app.category || categorizeApp(appName)
        };
        existing.duration += app.duration || 0;
        existing.count += 1;
        if (app.category && app.category !== 'unknown') {
          existing.category = app.category;
        }
        appUsageMap.set(appName, existing);
      }
    }

    // Also use topApps if appUsage is empty
    if ((!data.appUsage || data.appUsage.length === 0) && data.topApps) {
      for (const app of data.topApps) {
        const appName = app.appName || 'Unknown';
        const existing = appUsageMap.get(appName) || { 
          duration: 0, 
          count: 0,
          category: categorizeApp(appName)
        };
        existing.duration += app.duration || 0;
        existing.count += 1;
        appUsageMap.set(appName, existing);
      }
    }

    // Aggregate website visits
    if (data.websiteVisits && Array.isArray(data.websiteVisits)) {
      for (const site of data.websiteVisits) {
        const domain = site.domain || site.url || 'Unknown';
        const existing = websiteUsageMap.get(domain) || { 
          duration: 0, 
          visitCount: 0, 
          url: site.url,
          category: site.category || categorizeWebsite(domain)
        };
        existing.duration += site.duration || 0;
        existing.visitCount += 1;
        if (site.category && site.category !== 'unknown') {
          existing.category = site.category;
        }
        websiteUsageMap.set(domain, existing);
      }
    }

    // Also use topWebsites if websiteVisits is empty
    if ((!data.websiteVisits || data.websiteVisits.length === 0) && data.topWebsites) {
      for (const site of data.topWebsites) {
        const domain = site.domain || 'Unknown';
        const existing = websiteUsageMap.get(domain) || { 
          duration: 0, 
          visitCount: 0, 
          url: domain,
          category: categorizeWebsite(domain)
        };
        existing.duration += site.duration || 0;
        existing.visitCount += site.visits || 1;
        websiteUsageMap.set(domain, existing);
      }
    }

    // Aggregate time stats
    totalActiveTime += data.totalActiveTime || 0;
    productiveTime += data.productiveTime || 0;
    neutralTime += data.neutralTime || 0;
    unproductiveTime += data.unproductiveTime || 0;

    // Aggregate keystrokes
    if (data.keystrokes) {
      totalKeystrokes += data.keystrokes.totalCount || 0;
    }

    // Aggregate mouse activity
    if (data.mouseActivity) {
      totalMouseClicks += data.mouseActivity.clicks || 0;
      totalScrollDistance += data.mouseActivity.scrollDistance || 0;
      totalMovementDistance += data.mouseActivity.movementDistance || 0;
    }
  }

  // Convert maps to arrays and calculate percentages
  const appUsage = Array.from(appUsageMap.entries()).map(([appName, data]) => ({
    appName,
    category: data.category,
    duration: data.duration,
    percentage: 0
  }));

  const totalAppDuration = appUsage.reduce((sum, app) => sum + app.duration, 0);
  appUsage.forEach(app => {
    app.percentage = totalAppDuration > 0 ? Math.round((app.duration / totalAppDuration) * 100) : 0;
  });
  appUsage.sort((a, b) => b.duration - a.duration);

  const websiteVisits = Array.from(websiteUsageMap.entries()).map(([domain, data]) => ({
    domain,
    url: data.url,
    category: data.category,
    duration: data.duration,
    visitCount: data.visitCount
  }));
  websiteVisits.sort((a, b) => b.duration - a.duration);

  const appUsageSummary = appUsage.slice(0, 20).map(app => ({
    appName: app.appName,
    totalDuration: app.duration,
    category: app.category === 'distracting' ? 'unproductive' : app.category,
    percentage: app.percentage
  }));

  const totalWebDuration = websiteVisits.reduce((sum, w) => sum + w.duration, 0);
  const websiteVisitSummary = websiteVisits.slice(0, 20).map(site => ({
    domain: site.domain,
    totalDuration: site.duration,
    visitCount: site.visitCount,
    category: site.category === 'distracting' ? 'unproductive' : site.category,
    percentage: totalWebDuration > 0 ? Math.round((site.duration / totalWebDuration) * 100) : 0
  }));

  const effectiveTotalTime = totalActiveTime || totalAppDuration || 1;
  const productivityScore = effectiveTotalTime > 0 
    ? Math.round((productiveTime / effectiveTotalTime) * 100) 
    : 0;

  const sessionDurationMins = session.sessionDuration || Math.round((session.sessionEnd - session.sessionStart) / 60000);

  return {
    userId: session.userId,
    employeeId: session.employeeId,
    sessionStart: session.sessionStart,
    sessionEnd: session.sessionEnd,
    sessionDuration: sessionDurationMins,
    status: 'completed',
    isLastSessionOfDay: session.isLastSessionOfDay || false,
    checkoutTriggered: session.checkoutTriggered || false,
    
    screenshots,
    appUsageSummary,
    websiteVisitSummary,
    
    keystrokeSummary: {
      totalCount: totalKeystrokes,
      averagePerMinute: sessionDurationMins > 0 ? Math.round(totalKeystrokes / sessionDurationMins) : 0,
      peakMinute: 0
    },
    
    mouseActivitySummary: {
      totalClicks: totalMouseClicks,
      totalScrollDistance,
      totalMovementDistance
    },
    
    totalActiveTime: totalActiveTime || totalAppDuration,
    productiveTime,
    neutralTime,
    unproductiveTime,
    idleTime: 0,
    
    topApps: appUsage.slice(0, 5).map(a => ({
      appName: a.appName,
      duration: a.duration,
      percentage: a.percentage
    })),
    
    topWebsites: websiteVisits.slice(0, 5).map(w => ({
      domain: w.domain,
      duration: w.duration,
      visits: w.visitCount,
      percentage: totalWebDuration > 0 ? Math.round((w.duration / totalWebDuration) * 100) : 0
    })),
    
    aiAnalysis: {
      summary: generateSessionSummary(appUsage, websiteVisits, screenshots.length, sessionDurationMins, productivityScore, sessionIndex + 1),
      productivityScore,
      focusScore: calculateFocusScore(appUsage),
      efficiencyScore: calculateEfficiencyScore(totalKeystrokes, totalMouseClicks, sessionDurationMins),
      insights: generateInsights(appUsage, websiteVisits, productivityScore),
      recommendations: generateRecommendations(appUsage, productivityScore),
      areasOfImprovement: [],
      topAchievements: productivityScore >= 70 ? ['High productivity session'] : [],
      analyzedAt: new Date()
    },
    
    captureCount: dataPoints.length,
    sourceDataIds: dataPoints.map(d => d._id).filter(Boolean)
  };
}

/**
 * Categorize an app
 */
function categorizeApp(appName) {
  const name = appName.toLowerCase();
  
  const productivePatterns = [
    'code', 'visual studio', 'intellij', 'xcode', 'android studio', 'sublime',
    'terminal', 'iterm', 'powershell', 'cmd',
    'slack', 'teams', 'zoom', 'meet',
    'figma', 'sketch', 'adobe', 'photoshop', 'illustrator',
    'excel', 'word', 'powerpoint', 'numbers', 'pages', 'keynote',
    'notion', 'obsidian', 'evernote', 'onenote',
    'jira', 'asana', 'trello', 'monday', 'clickup',
    'postman', 'insomnia', 'docker', 'kubernetes',
    'github', 'gitlab', 'bitbucket',
    'mail', 'outlook', 'gmail'
  ];

  const distractingPatterns = [
    'youtube', 'netflix', 'spotify', 'music',
    'twitter', 'facebook', 'instagram', 'tiktok', 'snapchat',
    'reddit', 'discord',
    'game', 'steam', 'epic games',
    'whatsapp', 'telegram', 'messenger'
  ];

  if (productivePatterns.some(p => name.includes(p))) return 'productive';
  if (distractingPatterns.some(p => name.includes(p))) return 'distracting';
  return 'neutral';
}

/**
 * Categorize a website
 */
function categorizeWebsite(domain) {
  const d = domain.toLowerCase();
  
  const productiveDomains = [
    'github.com', 'gitlab.com', 'bitbucket.org',
    'stackoverflow.com', 'developer.', 'docs.',
    'notion.so', 'figma.com', 'miro.com',
    'atlassian.', 'jira.', 'confluence.',
    'slack.com', 'teams.microsoft.com',
    'google.com/docs', 'google.com/sheets', 'google.com/slides',
    'aws.amazon.com', 'console.cloud.google.com', 'portal.azure.com'
  ];

  const distractingDomains = [
    'youtube.com', 'netflix.com', 'twitch.tv',
    'twitter.com', 'facebook.com', 'instagram.com', 'tiktok.com',
    'reddit.com', 'discord.com',
    'spotify.com', 'soundcloud.com'
  ];

  if (productiveDomains.some(p => d.includes(p))) return 'productive';
  if (distractingDomains.some(p => d.includes(p))) return 'distracting';
  return 'neutral';
}

function calculateFocusScore(appUsage) {
  if (appUsage.length === 0) return 0;
  const totalApps = appUsage.length;
  const topAppPercentage = appUsage[0]?.percentage || 0;
  if (totalApps <= 3 && topAppPercentage >= 50) return 90;
  if (totalApps <= 5 && topAppPercentage >= 30) return 70;
  if (totalApps <= 8) return 50;
  return 30;
}

function calculateEfficiencyScore(keystrokes, clicks, minutes) {
  const totalActions = keystrokes + clicks;
  const actionsPerMinute = minutes > 0 ? totalActions / minutes : 0;
  if (actionsPerMinute >= 20 && actionsPerMinute <= 100) return 85;
  if (actionsPerMinute >= 10 && actionsPerMinute < 20) return 70;
  if (actionsPerMinute > 100 && actionsPerMinute <= 150) return 75;
  if (actionsPerMinute >= 5 && actionsPerMinute < 10) return 50;
  if (actionsPerMinute > 150) return 60;
  return 30;
}

function generateSessionSummary(appUsage, websiteVisits, screenshotCount, intervalMinutes, productivityScore, sessionNumber) {
  if (appUsage.length === 0) {
    return 'Session ' + sessionNumber + ': No significant activity detected.';
  }
  const topApp = appUsage[0];
  let summary = 'Session ' + sessionNumber + ': ' + screenshotCount + ' screenshots over ' + intervalMinutes + ' minutes. ';
  summary += productivityScore + '% productivity. ';
  summary += 'Primary focus: ' + topApp.appName + ' (' + topApp.percentage + '%).';
  return summary;
}

function generateInsights(appUsage, websiteVisits, productivityScore) {
  const insights = [];
  if (appUsage.length > 0) insights.push('Most used: ' + appUsage[0].appName + ' (' + appUsage[0].percentage + '%)');
  if (websiteVisits.length > 0) insights.push('Top website: ' + websiteVisits[0].domain);
  if (productivityScore >= 70) insights.push('Excellent focus on productive work');
  else if (productivityScore >= 50) insights.push('Good balance of work activities');
  return insights;
}

function generateRecommendations(appUsage, productivityScore) {
  const recommendations = [];
  if (productivityScore < 50) recommendations.push('Consider using focus mode to reduce distractions');
  if (appUsage.length > 5) recommendations.push('Try to focus on fewer applications at once');
  recommendations.push('Take regular breaks every 90 minutes');
  return recommendations;
}

/**
 * Save aggregated sessions to database
 */
export async function saveAggregatedSessions(sessions) {
  await connectDB();
  const savedSessions = [];
  
  for (const session of sessions) {
    try {
      const userObjId = toObjectId(session.userId);
      if (!userObjId) continue;
      
      const existing = await ProductivitySession.findOne({
        userId: userObjId,
        sessionStart: session.sessionStart
      });

      if (existing) {
        const hasExistingAnalysis = existing.aiAnalysis?.analyzedAt && 
          (existing.aiAnalysis?.summary || existing.aiAnalysis?.productivityScore > 0);
        
        if (hasExistingAnalysis) {
          savedSessions.push(existing.toObject());
          continue;
        }
        
        Object.assign(existing, session);
        await existing.save();
        savedSessions.push(existing.toObject());
      } else {
        const newSession = new ProductivitySession({ ...session, userId: userObjId });
        await newSession.save();
        savedSessions.push(newSession);
        console.log('[Session Aggregator] Created session', newSession._id.toString(), 'with', session.screenshots?.length || 0, 'screenshots');
      }
    } catch (err) {
      console.error('[Session Aggregator] Error saving session:', err.message);
    }
  }

  return savedSessions;
}

/**
 * Process all pending users for today
 */
export async function processAllPendingSessions() {
  await connectDB();
  const today = new Date();
  const dayStart = getStartOfDay(today);
  
  const usersWithData = await ProductivityData.distinct('userId', {
    createdAt: { $gte: dayStart },
    status: { $in: ['synced', 'analyzed'] }
  });

  console.log('[Session Aggregator] Found', usersWithData.length, 'users with today\'s data');

  const results = [];
  for (const userId of usersWithData) {
    try {
      const sessions = await aggregateSessionsForUser(userId, today, false);
      const saved = await saveAggregatedSessions(sessions);
      results.push({ userId, sessionsCreated: saved.length, success: true });
    } catch (error) {
      console.error('[Session Aggregator] Error processing user', userId, ':', error);
      results.push({ userId, success: false, error: error.message });
    }
  }

  return results;
}

/**
 * Recompile all sessions for a user for a date range
 */
export async function recompileSessionsForUser(userId, startDate, endDate) {
  await connectDB();
  const userObjId = toObjectId(userId);
  if (!userObjId) throw new Error('Invalid user ID');

  console.log('[Session Aggregator] Recompiling sessions for user', userId, 'from', startDate.toISOString(), 'to', endDate.toISOString());

  const allSessions = [];
  const currentDate = new Date(startDate);
  
  while (currentDate <= endDate) {
    const sessions = await aggregateSessionsForUser(userId, currentDate, true);
    const saved = await saveAggregatedSessions(sessions);
    allSessions.push(...saved);
    currentDate.setDate(currentDate.getDate() + 1);
  }

  console.log('[Session Aggregator] Recompiled', allSessions.length, 'total sessions');
  return allSessions;
}

/**
 * Recompile all sessions for all users
 */
export async function recompileAllSessions(daysBack = 30) {
  await connectDB();
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - daysBack * 24 * 60 * 60 * 1000);

  const users = await ProductivityData.distinct('userId', { createdAt: { $gte: startDate } });
  console.log('[Session Aggregator] Recompiling sessions for', users.length, 'users over last', daysBack, 'days');

  const results = [];
  for (const userId of users) {
    try {
      const sessions = await recompileSessionsForUser(userId, startDate, endDate);
      results.push({ userId: userId.toString(), sessionsCreated: sessions.length, success: true });
    } catch (error) {
      console.error('[Session Aggregator] Error recompiling for user', userId, ':', error);
      results.push({ userId: userId.toString(), success: false, error: error.message });
    }
  }

  return results;
}
