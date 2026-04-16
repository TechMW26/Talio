/**
 * Session Manager v5.0.0
 * Manages 60-minute activity sessions with 20 captures each (3-min intervals)
 */

const Store = require('electron-store');
const { randomBytes } = require('crypto');
const logger = require('./logger');

const store = new Store({ name: 'sessions' });

const SESSION_DURATION_MINUTES = 180;
const CAPTURES_PER_SESSION = 60;
const HISTORY_DAYS = 7;

function generateSessionId() {
  return 'session_' + Date.now() + '_' + randomBytes(4).toString('hex');
}

class SessionManager {
  constructor() {
    this.currentSession = null;
    this.userId = null;
    this.sessions = [];
    this.initialized = false;
  }

  initialize(userId) {
    if (this.initialized && this.userId === userId) {
      return this.currentSession;
    }
    this.userId = userId;
    this.loadSessions();
    this.initialized = true;
    const resumed = this.resumeActiveSession();
    logger.log('info', 'SessionManager', 'Initialized for user ' + userId + '. Resumed: ' + resumed);
    return this.currentSession;
  }

  loadSessions() {
    try {
      const allSessions = store.get('sessions', []);
      this.sessions = allSessions.filter(function (s) { return s.userId === this.userId; }.bind(this));
      this.cleanOldSessions();
    } catch (error) {
      logger.log('error', 'SessionManager', 'Load failed: ' + error.message);
      this.sessions = [];
    }
  }

  cleanOldSessions() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - HISTORY_DAYS);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];
    const before = this.sessions.length;
    this.sessions = this.sessions.filter(function (s) { return s.date >= cutoffStr; });
    if (before !== this.sessions.length) {
      logger.log('info', 'SessionManager', 'Cleaned ' + (before - this.sessions.length) + ' old sessions');
      this.saveSessions();
    }
  }

  resumeActiveSession() {
    const today = new Date().toISOString().split('T')[0];
    const userId = this.userId;
    const activeSession = this.sessions
      .filter(function (s) { return s.date === today && !s.isComplete; })
      .sort(function (a, b) { return new Date(b.startTime) - new Date(a.startTime); })[0];

    if (!activeSession) return false;

    const elapsed = Date.now() - new Date(activeSession.startTime).getTime();
    const minutesElapsed = elapsed / (1000 * 60);

    if (minutesElapsed < SESSION_DURATION_MINUTES && activeSession.captureCount < CAPTURES_PER_SESSION) {
      this.currentSession = activeSession;
      logger.log('info', 'SessionManager', 'Resumed session #' + activeSession.sessionNumber);
      return true;
    }

    activeSession.isComplete = true;
    activeSession.endTime = new Date().toISOString();
    this.saveSessions();
    return false;
  }

  startNewSession() {
    if (this.currentSession && !this.currentSession.isComplete) {
      this.endSession();
    }

    const today = new Date().toISOString().split('T')[0];
    const userId = this.userId;
    const todaySessions = this.sessions.filter(function (s) {
      return s.date === today && s.userId === userId;
    });

    this.currentSession = {
      sessionId: generateSessionId(),
      userId: this.userId,
      date: today,
      sessionNumber: todaySessions.length + 1,
      startTime: new Date().toISOString(),
      endTime: null,
      captures: [],
      captureCount: 0,
      isComplete: false,
      totalWorkMinutes: 0
    };

    this.sessions.push(this.currentSession);
    this.saveSessions();
    logger.log('info', 'SessionManager', 'Started session #' + this.currentSession.sessionNumber);
    return this.currentSession;
  }

  recordCapture(captureData) {
    captureData = captureData || {};

    if (!this.currentSession) {
      this.startNewSession();
    }

    let sessionRotated = false;

    if (this.currentSession.captureCount >= CAPTURES_PER_SESSION) {
      logger.log('info', 'SessionManager', 'Capture limit reached, rotating session');
      this.startNewSession();
      sessionRotated = true;
    }

    const elapsed = Date.now() - new Date(this.currentSession.startTime).getTime();
    if (elapsed >= SESSION_DURATION_MINUTES * 60 * 1000) {
      logger.log('info', 'SessionManager', 'Time limit reached, rotating session');
      this.startNewSession();
      sessionRotated = true;
    }

    const capture = {
      captureId: captureData.captureId || generateSessionId(),
      timestamp: new Date().toISOString(),
      imageUrl: captureData.imageUrl || null,
      imagekitFileId: captureData.imagekitFileId || null,
      captureType: captureData.captureType || 'automatic',
      offline: captureData.offline || false,
      metadata: captureData.metadata || {}
    };

    this.currentSession.captures.push(capture);
    this.currentSession.captureCount++;
    this.currentSession.endTime = new Date().toISOString();

    const sessionElapsed = Date.now() - new Date(this.currentSession.startTime).getTime();
    this.currentSession.totalWorkMinutes = Math.round(sessionElapsed / (1000 * 60));

    if (this.currentSession.captureCount >= CAPTURES_PER_SESSION) {
      this.currentSession.isComplete = true;
    }

    this.saveSessions();

    return {
      sessionId: this.currentSession.sessionId,
      sessionNumber: this.currentSession.sessionNumber,
      captureNumber: this.currentSession.captureCount,
      isComplete: this.currentSession.isComplete,
      sessionRotated: sessionRotated,
      capture: capture
    };
  }

  endSession() {
    if (!this.currentSession) return;

    this.currentSession.endTime = new Date().toISOString();
    this.currentSession.isComplete = true;

    const sessionElapsed = new Date(this.currentSession.endTime) - new Date(this.currentSession.startTime);
    this.currentSession.totalWorkMinutes = Math.round(sessionElapsed / (1000 * 60));

    this.saveSessions();
    logger.log('info', 'SessionManager', 'Ended session #' + this.currentSession.sessionNumber);
    this.currentSession = null;
  }

  getCurrentSession() {
    if (!this.currentSession) {
      this.startNewSession();
    }
    return this.currentSession;
  }

  getSessionInfo() {
    if (!this.currentSession) {
      return {
        sessionId: null,
        sessionNumber: 0,
        captureCount: 0,
        remainingCaptures: CAPTURES_PER_SESSION,
        isActive: false,
        startTime: null,
        workMinutes: 0,
        remainingMinutes: SESSION_DURATION_MINUTES
      };
    }

    const elapsed = Date.now() - new Date(this.currentSession.startTime).getTime();
    const workMinutes = Math.round(elapsed / (1000 * 60));
    const remainingMinutes = Math.max(0, SESSION_DURATION_MINUTES - workMinutes);

    return {
      sessionId: this.currentSession.sessionId,
      sessionNumber: this.currentSession.sessionNumber,
      captureCount: this.currentSession.captureCount,
      remainingCaptures: CAPTURES_PER_SESSION - this.currentSession.captureCount,
      isComplete: this.currentSession.isComplete,
      isActive: !this.currentSession.isComplete,
      startTime: this.currentSession.startTime,
      workMinutes: workMinutes,
      remainingMinutes: remainingMinutes
    };
  }

  saveSessions() {
    try {
      const allSessions = store.get('sessions', []);
      const userId = this.userId;
      const otherUsers = allSessions.filter(function (s) { return s.userId !== userId; });
      const merged = otherUsers.concat(this.sessions);
      store.set('sessions', merged);
    } catch (error) {
      logger.log('error', 'SessionManager', 'Save failed: ' + error.message);
    }
  }

  getTodayStats() {
    const today = new Date().toISOString().split('T')[0];
    const userId = this.userId;
    const todaySessions = this.sessions.filter(function (s) {
      return s.date === today && s.userId === userId;
    });

    let totalWorkMinutes = 0;
    for (let i = 0; i < todaySessions.length; i++) {
      const s = todaySessions[i];
      if (s.isComplete) {
        totalWorkMinutes += (s.totalWorkMinutes || 0);
      } else {
        const elapsed = Date.now() - new Date(s.startTime).getTime();
        totalWorkMinutes += Math.round(elapsed / (1000 * 60));
      }
    }

    let totalCaptures = 0;
    let completedSessions = 0;
    for (let i = 0; i < todaySessions.length; i++) {
      totalCaptures += todaySessions[i].captureCount;
      if (todaySessions[i].isComplete) completedSessions++;
    }

    return {
      date: today,
      totalSessions: todaySessions.length,
      totalCaptures: totalCaptures,
      completedSessions: completedSessions,
      totalWorkMinutes: totalWorkMinutes,
      totalWorkHours: (totalWorkMinutes / 60).toFixed(1),
      currentSession: this.getSessionInfo()
    };
  }

  getHistory(days) {
    days = days || 7;
    const history = [];
    const today = new Date();
    const userId = this.userId;

    for (let i = 0; i < days; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      const daySessions = this.sessions.filter(function (s) {
        return s.date === dateStr && s.userId === userId;
      });

      let captureCount = 0;
      let workMinutes = 0;
      for (let j = 0; j < daySessions.length; j++) {
        captureCount += daySessions[j].captureCount;
        workMinutes += (daySessions[j].totalWorkMinutes || 0);
      }

      history.push({
        date: dateStr,
        sessionCount: daySessions.length,
        captureCount: captureCount,
        workMinutes: workMinutes
      });
    }

    return history;
  }

  reset() {
    if (this.currentSession) {
      this.endSession();
    }
    this.currentSession = null;
    this.userId = null;
    this.sessions = [];
    this.initialized = false;
    logger.log('info', 'SessionManager', 'Reset complete');
  }
}

module.exports = new SessionManager();
