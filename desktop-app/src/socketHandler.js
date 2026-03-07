/**
 * Socket Handler v4.0.0
 * Manages real-time communication with Talio server
 */

const { io } = require('socket.io-client');
const logger = require('./logger');

const SOCKET_URL = 'https://app.talio.in';
const SOCKET_PATH = '/api/socketio';

class SocketHandler {
  constructor() {
    this.socket = null;
    this.userId = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.callbacks = {};
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
      reconnectionDelayMax: 10000,
      reconnectionAttempts: this.maxReconnectAttempts,
      timeout: 20000,
      auth: {
        token: token
      }
    });
    
    this.setupEventHandlers();
    logger.log('info', 'SocketHandler', 'Initialized for user ' + userId);
  }

  setupEventHandlers() {
    var self = this;
    
    this.socket.on('connect', function() {
      self.isConnected = true;
      self.reconnectAttempts = 0;
      logger.log('info', 'SocketHandler', 'Connected: ' + self.socket.id);
      
      // Register as desktop app
      self.socket.emit('desktop-app-ready', { userId: self.userId });
      
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
    });
    
    this.socket.on('connect_error', function(error) {
      self.reconnectAttempts++;
      logger.log('error', 'SocketHandler', 'Connection error: ' + error.message);
      
      if (self.callbacks.onError) {
        self.callbacks.onError(error);
      }
    });
    
    this.socket.on('reconnect', function(attemptNumber) {
      logger.log('info', 'SocketHandler', 'Reconnected after ' + attemptNumber + ' attempts');
      self.socket.emit('desktop-app-ready', { userId: self.userId });
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

  disconnect() {
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
    this.reconnectAttempts = 0;
    logger.log('info', 'SocketHandler', 'Reset complete');
  }
}

module.exports = new SocketHandler();
