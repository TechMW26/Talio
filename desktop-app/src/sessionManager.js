const Store = require('electron-store');
const { randomBytes } = require('crypto');

const store = new Store();

/**
 * Generate a simple unique ID
 */
function generateId() {
  return `${Date.now()}-${randomBytes(4).toString('hex')}`;
}

/**
 * Session Manager
 * Manages 30-minute activity sessions with 30 captures each
 */
class SessionManager {
  constructor(options = {}) {
    this.sessionDuration = options.sessionDuration || 30; // minutes
    this.capturesPerSession = options.capturesPerSession || 30;
    this.currentSession = null;
    this.userId = null;
    this.sessions = store.get('sessions', []);
  }

  /**
   * Start a new session
   */
  startNewSession(userId) {
    this.userId = userId;
    
    // Check for existing active session
    if (this.currentSession && !this.currentSession.isComplete) {
      const elapsed = Date.now() - new Date(this.currentSession.startTime).getTime();
      const minutesElapsed = elapsed / (1000 * 60);
      
      if (minutesElapsed < this.sessionDuration) {
        console.log(`[Session] Resuming session #${this.currentSession.sessionNumber}`);
        return this.currentSession;
      }
    }

    // End previous session
    if (this.currentSession) {
      this.endSession();
    }

    // Count today's sessions
    const today = new Date().toISOString().split('T')[0];
    const todaySessions = this.sessions.filter(s => 
      s.date === today && s.userId === userId
    );
    
    // Create new session
    this.currentSession = {
      sessionId: generateId(),
      userId,
      date: today,
      sessionNumber: todaySessions.length + 1,
      startTime: new Date().toISOString(),
      endTime: null,
      captures: [],
      captureCount: 0,
      isComplete: false
    };

    console.log(`[Session] Started session #${this.currentSession.sessionNumber}`);
    
    this.sessions.push(this.currentSession);
    this.saveSessions();
    
    return this.currentSession;
  }

  /**
   * Record a capture
   */
  recordCapture(captureData) {
    if (!this.currentSession) {
      this.startNewSession(this.userId || captureData.userId);
    }

    // Check if session needs rotation
    if (this.currentSession.captureCount >= this.capturesPerSession) {
      console.log('[Session] 30 captures reached, rotating session');
      this.startNewSession(this.userId);
    }

    // Check session time limit
    const elapsed = Date.now() - new Date(this.currentSession.startTime).getTime();
    if (elapsed >= this.sessionDuration * 60 * 1000) {
      console.log('[Session] 30 minutes elapsed, rotating session');
      this.startNewSession(this.userId);
    }

    // Record capture
    this.currentSession.captures.push({
      timestamp: new Date().toISOString(),
      localPath: captureData.localPath,
      size: captureData.size
    });
    
    this.currentSession.captureCount++;
    this.currentSession.endTime = new Date().toISOString();

    // Mark complete if 30 captures
    if (this.currentSession.captureCount >= this.capturesPerSession) {
      this.currentSession.isComplete = true;
    }

    this.saveSessions();

    return {
      sessionId: this.currentSession.sessionId,
      sessionNumber: this.currentSession.sessionNumber,
      captureNumber: this.currentSession.captureCount
    };
  }

  /**
   * End current session
   */
  endSession() {
    if (this.currentSession) {
      this.currentSession.endTime = new Date().toISOString();
      this.currentSession.isComplete = true;
      this.saveSessions();
      console.log(`[Session] Ended session #${this.currentSession.sessionNumber} with ${this.currentSession.captureCount} captures`);
    }
    this.currentSession = null;
  }

  /**
   * Get current session info
   */
  getCurrentSessionInfo() {
    if (!this.currentSession) {
      return {
        sessionId: null,
        sessionNumber: 0,
        captureCount: 0,
        isActive: false
      };
    }

    return {
      sessionId: this.currentSession.sessionId,
      sessionNumber: this.currentSession.sessionNumber,
      captureCount: this.currentSession.captureCount,
      startTime: this.currentSession.startTime,
      isComplete: this.currentSession.isComplete,
      isActive: !this.currentSession.isComplete
    };
  }

  /**
   * Check if session is active
   */
  isSessionActive() {
    return this.currentSession && !this.currentSession.isComplete;
  }

  /**
   * Save sessions to store
   */
  saveSessions() {
    // Only keep last 7 days of sessions
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoffDate = sevenDaysAgo.toISOString().split('T')[0];
    
    this.sessions = this.sessions.filter(s => s.date >= cutoffDate);
    store.set('sessions', this.sessions);
  }

  /**
   * Get sessions for a date
   */
  getSessionsForDate(date) {
    const dateStr = typeof date === 'string' ? date : date.toISOString().split('T')[0];
    return this.sessions.filter(s => 
      s.date === dateStr && s.userId === this.userId
    );
  }

  /**
   * Get today's stats
   */
  getTodayStats() {
    const today = new Date().toISOString().split('T')[0];
    const todaySessions = this.getSessionsForDate(today);
    
    return {
      date: today,
      totalSessions: todaySessions.length,
      totalCaptures: todaySessions.reduce((sum, s) => sum + s.captureCount, 0),
      completedSessions: todaySessions.filter(s => s.isComplete).length,
      currentSession: this.getCurrentSessionInfo()
    };
  }
}

module.exports = { SessionManager };
