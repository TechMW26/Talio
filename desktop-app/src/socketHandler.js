/**
 * Socket Handler v4.2.0
 * Manages real-time communication with Talio server
 * Enhanced with full notification event coverage and robust reconnection
 */

const { io } = require('socket.io-client');
const { app } = require('electron');
const logger = require('./logger');

const SOCKET_URL = 'https://app.talio.in';
const SOCKET_PATH = '/api/socketio';

class SocketHandler {
  constructor() {
    this.socket = null;
    this.userId = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = Infinity; // Never stop reconnecting
    this.callbacks = {};
    this.reconnectTimer = null;
  }

  initialize(userId, token) {
    this.userId = userId;
    
    if (this.socket) {
      this.disconnect();
    }
    
    this.socket = io(SOCKET_URL, {
      path: SOCKET_PATH,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: Infinity, // Never give up reconnecting
      timeout: 20000,
      auth: {
        token: token
      }
    });
    
    this._token = token;
    this.setupEventHandlers();
    logger.log('info', 'SocketHandler', 'Initialized for user ' + userId);
  }

  setupEventHandlers() {
    var self = this;
    
    this.socket.on('connect', function() {
      self.isConnected = true;
      self.reconnectAttempts = 0;
      logger.log('info', 'SocketHandler', 'Connected: ' + self.socket.id);
      
      // Register as desktop app with version info
      self.socket.emit('desktop-app-ready', { userId: self.userId, appVersion: app.getVersion() });
      
      // Trigger callback
      if (self.callbacks.onConnect) {
        self.callbacks.onConnect();
      }
    });
    
    this.socket.on('disconnect', function(reason) {
      self.isConnected = false;
      logger.log('warn', 'SocketHandler', 'Disconnected: ' + reason);
      
      if (self.callbacks.onDisconnect) {
        self.callbacks.onDisconnect(reason);
      }

      // If server disconnected us, manually reconnect after delay
      if (reason === 'io server disconnect' || reason === 'transport close') {
        self.scheduleReconnect();
      }
    });
    
    this.socket.on('connect_error', function(error) {
      self.reconnectAttempts++;
      logger.log('error', 'SocketHandler', 'Connection error (attempt ' + self.reconnectAttempts + '): ' + error.message);
      
      if (self.callbacks.onError) {
        self.callbacks.onError(error);
      }

      // If socket.io's built-in reconnection gives up, force a manual reconnect
      if (self.reconnectAttempts > 20) {
        self.scheduleReconnect();
      }
    });
    
    this.socket.on('reconnect', function(attemptNumber) {
      logger.log('info', 'SocketHandler', 'Reconnected after ' + attemptNumber + ' attempts');
      self.socket.emit('desktop-app-ready', { userId: self.userId, appVersion: app.getVersion() });
    });

    // When built-in reconnection fails completely
    this.socket.on('reconnect_failed', function() {
      logger.log('warn', 'SocketHandler', 'Built-in reconnection failed, scheduling manual reconnect');
      self.scheduleReconnect();
    });
    
    // Handle registration confirmation
    this.socket.on('registration-confirmed', function(data) {
      logger.log('info', 'SocketHandler', 'Desktop app registered: ' + JSON.stringify(data));
    });
    
    // Handle screenshot request from admin
    this.socket.on('request-screenshot', function(data) {
      logger.log('info', 'SocketHandler', 'Screenshot requested by admin');
      if (self.callbacks.onScreenshotRequest) {
        self.callbacks.onScreenshotRequest(data);
      }
    });
    
    // Handle capture toggle from admin
    this.socket.on('toggle-capture', function(data) {
      logger.log('info', 'SocketHandler', 'Capture toggle requested: ' + JSON.stringify(data));
      if (self.callbacks.onCaptureToggle) {
        self.callbacks.onCaptureToggle(data);
      }
    });
    
    // Handle new notification
    this.socket.on('new-notification', function(data) {
      logger.log('info', 'SocketHandler', 'New notification: ' + (data.title || 'Unknown'));
      if (self.callbacks.onNotification) {
        self.callbacks.onNotification(data);
      }
    });
    
    // Handle call alert
    this.socket.on('call-alert', function(data) {
      logger.log('info', 'SocketHandler', 'Call alert received');
      if (self.callbacks.onCallAlert) {
        self.callbacks.onCallAlert(data);
      }
    });
    
    // Handle attendance update
    this.socket.on('attendance-update', function(data) {
      self.isConnected = true;
      logger.log('info', 'SocketHandler', 'Attendance update');
      if (self.callbacks.onAttendanceUpdate) {
        self.callbacks.onAttendanceUpdate(data);
      }
    });

    // Handle TicTacToe game invite
    this.socket.on('tictactoe:invite', function(data) {
      logger.log('info', 'SocketHandler', 'Game invite from: ' + (data.fromName || 'Unknown'));
      if (self.callbacks.onGameInvite) {
        self.callbacks.onGameInvite(data);
      }
    });

    // ── Full notification event coverage (mirrors mobile + web) ──

    // Helper to fire notification callback
    function notify(title, data, defaultMsg) {
      if (self.callbacks.onNotification) {
        self.callbacks.onNotification({ title: title, message: data.message || data.body || defaultMsg, url: data.url || null, type: data.type || data.eventType || null, ...data });
      }
    }

    // Helper for silent data events (no notification, just callback)
    function silentEvent(name, data) {
      if (self.callbacks['on' + name]) {
        self.callbacks['on' + name](data);
      }
    }

    // ── Attendance events ──
    this.socket.on('attendance-check-in', function(data) {
      logger.log('info', 'SocketHandler', 'Attendance check-in');
      notify('Checked In ✅', data, 'You have been checked in');
    });

    this.socket.on('attendance-check-out', function(data) {
      logger.log('info', 'SocketHandler', 'Attendance check-out');
      notify('Checked Out 👋', data, 'You have been checked out');
    });

    // ── Leave events ──
    this.socket.on('leave-request', function(data) {
      logger.log('info', 'SocketHandler', 'Leave request');
      notify('Leave Request', data, 'New leave request received');
    });

    this.socket.on('leave-status-update', function(data) {
      logger.log('info', 'SocketHandler', 'Leave status update');
      notify('Leave Update', data, 'Your leave request has been updated');
    });

    this.socket.on('leave-cancelled', function(data) {
      logger.log('info', 'SocketHandler', 'Leave cancelled');
      notify('Leave Cancelled', data, 'A leave request has been cancelled');
    });

    // ── Expense events ──
    this.socket.on('expense-submitted', function(data) {
      logger.log('info', 'SocketHandler', 'Expense submitted');
      notify('Expense Submitted', data, 'An expense has been submitted for approval');
    });

    this.socket.on('expense-status-update', function(data) {
      logger.log('info', 'SocketHandler', 'Expense status update');
      notify('Expense Update', data, 'Your expense request has been updated');
    });

    // ── Travel events ──
    this.socket.on('travel-request', function(data) {
      logger.log('info', 'SocketHandler', 'Travel request');
      notify('Travel Request', data, 'New travel request received');
    });

    this.socket.on('travel-status-update', function(data) {
      logger.log('info', 'SocketHandler', 'Travel status update');
      notify('Travel Update', data, 'Your travel request has been updated');
    });

    // ── Task events ──
    this.socket.on('task-created', function(data) {
      logger.log('info', 'SocketHandler', 'Task created');
      notify('New Task', data, 'A new task has been created');
    });

    this.socket.on('task-assigned', function(data) {
      logger.log('info', 'SocketHandler', 'Task assigned');
      notify('Task Assigned', data, 'A task has been assigned to you');
    });

    this.socket.on('task-updated', function(data) {
      logger.log('info', 'SocketHandler', 'Task updated');
      notify('Task Updated', data, 'A task has been updated');
    });

    this.socket.on('task-status-changed', function(data) {
      logger.log('info', 'SocketHandler', 'Task status changed');
      notify('Task Status Changed', data, 'A task status has been updated');
    });

    this.socket.on('task-deleted', function(data) {
      logger.log('info', 'SocketHandler', 'Task deleted');
      silentEvent('TaskDeleted', data);
    });

    // ── Project events ──
    this.socket.on('project-created', function(data) {
      logger.log('info', 'SocketHandler', 'Project created');
      notify('New Project', data, 'A new project has been created');
    });

    this.socket.on('project-updated', function(data) {
      logger.log('info', 'SocketHandler', 'Project updated');
      silentEvent('ProjectUpdated', data);
    });

    this.socket.on('project-deleted', function(data) {
      logger.log('info', 'SocketHandler', 'Project deleted');
      silentEvent('ProjectDeleted', data);
    });

    this.socket.on('project-assignment', function(data) {
      logger.log('info', 'SocketHandler', 'Project assignment');
      notify('Project Assignment', data, 'You have been assigned to a project');
    });

    // ── Meeting events ──
    this.socket.on('meeting-created', function(data) {
      logger.log('info', 'SocketHandler', 'Meeting created');
      notify('New Meeting 📅', data, 'A new meeting has been scheduled');
    });

    this.socket.on('meeting-updated', function(data) {
      logger.log('info', 'SocketHandler', 'Meeting updated');
      notify('Meeting Updated', data, 'A meeting has been updated');
    });

    this.socket.on('meeting-cancelled', function(data) {
      logger.log('info', 'SocketHandler', 'Meeting cancelled');
      notify('Meeting Cancelled', data, 'A meeting has been cancelled');
    });

    // ── Announcement events ──
    this.socket.on('announcement-created', function(data) {
      logger.log('info', 'SocketHandler', 'Announcement created');
      notify('New Announcement 📢', data, 'A new announcement has been posted');
    });

    this.socket.on('announcement-updated', function(data) {
      logger.log('info', 'SocketHandler', 'Announcement updated');
      silentEvent('AnnouncementUpdated', data);
    });

    // ── Helpdesk events ──
    this.socket.on('helpdesk-ticket', function(data) {
      logger.log('info', 'SocketHandler', 'Helpdesk ticket');
      notify('Helpdesk Ticket', data, 'New helpdesk ticket received');
    });

    this.socket.on('helpdesk-ticket-updated', function(data) {
      logger.log('info', 'SocketHandler', 'Helpdesk ticket updated');
      notify('Ticket Updated', data, 'A helpdesk ticket has been updated');
    });

    // ── Performance events ──
    this.socket.on('performance-review', function(data) {
      logger.log('info', 'SocketHandler', 'Performance review');
      notify('Performance Review ⭐', data, 'You have a new performance review');
    });

    // ── Payroll events ──
    this.socket.on('payroll-update', function(data) {
      logger.log('info', 'SocketHandler', 'Payroll update');
      notify('Payroll Update 💰', data, 'Payroll has been updated');
    });

    // ── Document events ──
    this.socket.on('document-update', function(data) {
      logger.log('info', 'SocketHandler', 'Document update');
      notify('Document Updated', data, 'A document has been updated');
    });

    // ── Asset events ──
    this.socket.on('asset-update', function(data) {
      logger.log('info', 'SocketHandler', 'Asset update');
      notify('Asset Update', data, 'An asset record has been updated');
    });

    // ── Daily goals ──
    this.socket.on('daily-goal-updated', function(data) {
      logger.log('info', 'SocketHandler', 'Daily goal updated');
      notify('Goal Updated 🎯', data, 'A daily goal has been updated');
    });

    // ── Geofence events ──
    this.socket.on('geofence-approval', function(data) {
      logger.log('info', 'SocketHandler', 'Geofence approval');
      notify('Geofence Approved', data, 'Your geofence request has been approved');
    });

    // ── Recruitment events ──
    this.socket.on('recruitment-update', function(data) {
      logger.log('info', 'SocketHandler', 'Recruitment update');
      notify('Recruitment Update', data, 'A recruitment update is available');
    });

    this.socket.on('recruitment-job-created', function(data) {
      logger.log('info', 'SocketHandler', 'Recruitment job created');
      notify('New Job Posted', data, 'A new job position has been posted');
    });

    this.socket.on('recruitment-job-updated', function(data) {
      logger.log('info', 'SocketHandler', 'Recruitment job updated');
      silentEvent('RecruitmentJobUpdated', data);
    });

    this.socket.on('recruitment-candidate-updated', function(data) {
      logger.log('info', 'SocketHandler', 'Recruitment candidate updated');
      notify('Candidate Update', data, 'A candidate record has been updated');
    });

    this.socket.on('recruitment-candidate-stage-changed', function(data) {
      logger.log('info', 'SocketHandler', 'Recruitment candidate stage changed');
      notify('Candidate Stage Changed', data, 'A candidate has moved to a new stage');
    });

    this.socket.on('recruitment-interview-scheduled', function(data) {
      logger.log('info', 'SocketHandler', 'Interview scheduled');
      notify('Interview Scheduled 📋', data, 'An interview has been scheduled');
    });

    this.socket.on('recruitment-interview-updated', function(data) {
      logger.log('info', 'SocketHandler', 'Interview updated');
      notify('Interview Updated', data, 'An interview has been updated');
    });

    // ── Holiday / Policy events ──
    this.socket.on('holiday-update', function(data) {
      logger.log('info', 'SocketHandler', 'Holiday update');
      notify('Holiday Update 🗓️', data, 'A holiday has been added or updated');
    });

    this.socket.on('policy-update', function(data) {
      logger.log('info', 'SocketHandler', 'Policy update');
      notify('Policy Update', data, 'A company policy has been updated');
    });

    // ── Employee events (silent — no notification popup) ──
    this.socket.on('employee-created', function(data) {
      silentEvent('EmployeeCreated', data);
    });

    this.socket.on('employee-updated', function(data) {
      silentEvent('EmployeeUpdated', data);
    });

    this.socket.on('employee-deleted', function(data) {
      silentEvent('EmployeeDeleted', data);
    });

    this.socket.on('department-updated', function(data) {
      silentEvent('DepartmentUpdated', data);
    });

    // ── Dashboard / UI events (silent) ──
    this.socket.on('dashboard-refresh', function(data) {
      logger.log('info', 'SocketHandler', 'Dashboard refresh');
      silentEvent('DashboardRefresh', data);
    });

    this.socket.on('chat.unread.updated', function(data) {
      silentEvent('ChatUnreadUpdated', data);
    });

    this.socket.on('sidebar.counts.updated', function(data) {
      silentEvent('SidebarCountsUpdated', data);
    });

    // ── Force refresh from server ──
    this.socket.on('force-refresh', function(data) {
      logger.log('warn', 'SocketHandler', 'Force refresh requested from server');
      notify('App Update Required', data, 'Talio needs to refresh. Reloading...');
      if (self.callbacks.onForceRefresh) {
        self.callbacks.onForceRefresh(data);
      }
    });

    // ── Server-triggered update check ──
    this.socket.on('trigger-update-check', function(data) {
      logger.log('info', 'SocketHandler', 'Server requested update check (latest: ' + (data?.latestVersion || 'unknown') + ')');
      if (self.callbacks.onTriggerUpdateCheck) {
        self.callbacks.onTriggerUpdateCheck(data);
      }
    });
  }

  on(event, callback) {
    this.callbacks['on' + event.charAt(0).toUpperCase() + event.slice(1)] = callback;
  }

  emit(event, data) {
    if (this.socket && this.isConnected) {
      this.socket.emit(event, data);
      return true;
    }
    logger.log('warn', 'SocketHandler', 'Cannot emit - not connected');
    return false;
  }

  /**
   * Schedule a manual reconnection attempt with exponential backoff
   * Used when socket.io's built-in reconnection has been exhausted
   */
  scheduleReconnect() {
    var self = this;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    var delay = Math.min(5000 * Math.pow(1.5, Math.min(this.reconnectAttempts, 10)), 60000);
    logger.log('info', 'SocketHandler', 'Manual reconnect in ' + Math.round(delay / 1000) + 's');

    this.reconnectTimer = setTimeout(function () {
      if (!self.isConnected && self.userId && self._token) {
        logger.log('info', 'SocketHandler', 'Attempting manual reconnect...');
        self.initialize(self.userId, self._token);
      }
    }, delay);
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.isConnected = false;
    logger.log('info', 'SocketHandler', 'Disconnected');
  }

  getStatus() {
    return {
      isConnected: this.isConnected,
      socketId: this.socket ? this.socket.id : null,
      reconnectAttempts: this.reconnectAttempts
    };
  }

  reset() {
    this.disconnect();
    this.callbacks = {};
    this.userId = null;
    this._token = null;
    this.reconnectAttempts = 0;
    logger.log('info', 'SocketHandler', 'Reset complete');
  }
}

module.exports = new SocketHandler();
