const Store = require('electron-store');
const { v4: uuidv4 } = require('uuid');

const store = new Store();

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
   * Start a new session for the user
   */
  startNewSession(userId) {
    this.userId = userId;
    
    // Check if there's an existing active session
    if (this.currentSession && !this.currentSession.isComplete) {
      const elapsed = Date.now() - new Date(this.currentSession.startTime).getTime();
      const minutesElapsed = elapsed / (1000 * 60);
      
      // If less than 30 minutes have passed and not complete, continue it
      if (minutesElapsed < this.sessionDuration) {
        console.log(`[SessionManager] Resuming existing session ${this.currentSession.sessionId}`);
        return this.currentSession;
      }
    }

    // End previous session if exists
    if (this.currentSession) {
      this.endSession();
    }

    // Create new session
    const today = new Date().toISOString().split('T')[0];
    const todaySessions = this.sessions.filter(s => 
      s.date === today && s.userId === userId
    );
    
    this.currentSession = {
      sessionId: uuidv4(),
      userId,
      date: today,
      sessionNumber: todaySessions.length + 1,
      startTime: new Date().toISOString(),
      endTime: null,
      captures: [],
      captureCount: 0,
      isComplete: false,
      metadata: {
        platform: process.platform,
        appVersion: require('electron').app?.getVersion() || '1.0.0'
      }
    };

    console.log(`[SessionManager] Started new session #${this.currentSession.sessionNumber} (${this.currentSession.sessionId})`);
    
    // Save to store
    this.sessions.push(this.currentSession);
    store.set('sessions', this.sessions);
    
    return this.currentSession;
  }

  /**
   * Record a capture in the current session
   */
  recordCapture(captureData) {
    if (!this.currentSession) {
      console.log('[SessionManager] No active session, starting new one');
      this.startNewSession(this.userId || captureData.userId);
    }

    // Check if session is complete (30 captures)
    if (this.currentSession.captureCount >= this.capturesPerSession) {
      console.log('[SessionManager] Session complete, starting new session');
      this.startNewSession(this.userId);
    }

    // Check if session has exceeded 30 minutes
    const elapsed = Date.now() - new Date(this.currentSession.startTime).getTime();
    const minutesElapsed = elapsed / (1000 * 60);
    if (minutesElapsed >= this.sessionDuration) {
      console.log('[SessionManager] Session time exceeded, starting new session');
      this.startNewSession(this.userId);
    }

    // Add capture to session
    const capture = {
      timestamp: new Date().toISOString(),
      path: captureData.path,
      size: captureData.size,
      captureNumber: this.currentSession.captureCount + 1
    };

    this.currentSession.captures.push(capture);
    this.currentSession.captureCount++;
    this.currentSession.lastCaptureTime = capture.timestamp;

    // Check if session is now complete
    if (this.currentSession.captureCount >= this.capturesPerSession) {
      this.currentSession.isComplete = true;
      this.currentSession.endTime = new Date().toISOString();
      console.log(`[SessionManager] Session #${this.currentSession.sessionNumber} completed with ${this.currentSession.captureCount} captures`);
    }

    // Update in store
    const sessionIndex = this.sessions.findIndex(s => s.sessionId === this.currentSession.sessionId);
    if (sessionIndex !== -1) {
      this.sessions[sessionIndex] = this.currentSession;
    }
    store.set('sessions', this.sessions);

    return {
      sessionId: this.currentSession.sessionId,
      sessionNumber: this.currentSession.sessionNumber,
      captureNumber: capture.captureNumber,
      isComplete: this.currentSession.isComplete
    };
  }

  /**
   * End the current session
   */
  endSession() {
    if (!this.currentSession) return;

    this.currentSession.endTime = new Date().toISOString();
    this.currentSession.isComplete = true;

    // Update in store
    const sessionIndex = this.sessions.findIndex(s => s.sessionId === this.currentSession.sessionId);
    if (sessionIndex !== -1) {
      this.sessions[sessionIndex] = this.currentSession;
    }
    store.set('sessions', this.sessions);

    console.log(`[SessionManager] Session #${this.currentSession.sessionNumber} ended with ${this.currentSession.captureCount} captures`);
    
    this.currentSession = null;
  }

  /**
   * Check if there's an active session
   */
  isSessionActive() {
    if (!this.currentSession) return false;
    
    // Check if session time has exceeded
    const elapsed = Date.now() - new Date(this.currentSession.startTime).getTime();
    const minutesElapsed = elapsed / (1000 * 60);
    
    return !this.currentSession.isComplete && minutesElapsed < this.sessionDuration;
  }

  /**
   * Get current session info
   */
  getCurrentSessionInfo() {
    if (!this.currentSession) {
      return {
        active: false,
        sessionNumber: null,
        captureCount: 0,
        remainingCaptures: 30,
        timeElapsed: 0,
        timeRemaining: 30
      };
    }

    const elapsed = Date.now() - new Date(this.currentSession.startTime).getTime();
    const minutesElapsed = Math.floor(elapsed / (1000 * 60));
    const minutesRemaining = Math.max(0, this.sessionDuration - minutesElapsed);

    return {
      active: this.isSessionActive(),
      sessionId: this.currentSession.sessionId,
      sessionNumber: this.currentSession.sessionNumber,
      captureCount: this.currentSession.captureCount,
      remainingCaptures: this.capturesPerSession - this.currentSession.captureCount,
      timeElapsed: minutesElapsed,
      timeRemaining: minutesRemaining,
      startTime: this.currentSession.startTime,
      isComplete: this.currentSession.isComplete,
      date: this.currentSession.date
    };
  }

  /**
   * Get sessions for a specific date
   */
  getSessionsForDate(date, userId) {
    const dateStr = typeof date === 'string' ? date : date.toISOString().split('T')[0];
    return this.sessions.filter(s => s.date === dateStr && s.userId === userId);
  }

  /**
   * Get all sessions for a user
   */
  getUserSessions(userId) {
    return this.sessions.filter(s => s.userId === userId);
  }

  /**
   * Clean up old sessions (older than 7 days)
   */
  cleanupOldSessions() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 7);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];

    const originalCount = this.sessions.length;
    this.sessions = this.sessions.filter(s => s.date >= cutoffStr);
    store.set('sessions', this.sessions);

    const removedCount = originalCount - this.sessions.length;
    if (removedCount > 0) {
      console.log(`[SessionManager] Cleaned up ${removedCount} old sessions`);
    }
  }
}

module.exports = { SessionManager };
