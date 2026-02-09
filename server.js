const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = process.env.PORT || 3000;

// Initialize Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Global socket instance
let io;

// In-memory presence tracking (employeeId -> { sockets: Set, lastSeenAt: Date|null })
const presenceByEmployee = new Map();
// Also track by userId for live users API
const presenceByUserId = new Map();

// Expose globally for API routes
global.presenceByEmployee = presenceByEmployee;
global.presenceByUserId = presenceByUserId;

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  // Initialize Socket.IO with increased payload limit for voice audio
  io = new Server(server, {
    path: '/api/socketio',
    addTrailingSlash: false,
    maxHttpBufferSize: 5e6, // 5MB - needed for base64 encoded voice audio
    cors: {
      origin: process.env.NEXT_PUBLIC_APP_URL || '*',
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  // Make io accessible globally (for API routes)
  global.io = io;

  io.on('connection', (socket) => {
    console.log('✅ [Socket.IO] Client connected:', socket.id);

    // Authenticate user
    socket.on('authenticate', (payload) => {
      const resolvedUserId = typeof payload === 'object' ? payload?.userId || payload?.id : payload;
      const resolvedEmployeeId = typeof payload === 'object' ? payload?.employeeId : null;

      if (resolvedUserId) {
        socket.userId = resolvedUserId.toString();
        socket.join(`user:${socket.userId}`);
        console.log(`🔐 [Socket.IO] User ${socket.userId} authenticated`);
        
        // Track user presence by userId
        const userEntry = presenceByUserId.get(socket.userId) || { sockets: new Set(), lastSeenAt: null };
        userEntry.sockets.add(socket.id);
        presenceByUserId.set(socket.userId, userEntry);
      }

      if (resolvedEmployeeId) {
        const employeeId = resolvedEmployeeId.toString();
        socket.employeeId = employeeId;

        const entry = presenceByEmployee.get(employeeId) || { sockets: new Set(), lastSeenAt: null };
        const wasOnline = entry.sockets.size > 0;
        entry.sockets.add(socket.id);
        presenceByEmployee.set(employeeId, entry);

        if (!wasOnline) {
          io.emit('presence-update', {
            employeeId,
            isOnline: true,
            lastSeenAt: entry.lastSeenAt || null
          });
        }
      }
    });

    // Join user-specific notification room (for desktop apps)
    socket.on('join-user-room', (userId) => {
      socket.userId = userId;
      socket.join(`user:${userId}`);
      console.log(`🔔 [Socket.IO] User ${userId} joined notification room`);
    });

    // Presence requests from clients
    socket.on('presence-request', (data) => {
      const employeeIds = Array.isArray(data?.employeeIds) ? data.employeeIds : [];
      const statuses = employeeIds
        .map((id) => id?.toString?.())
        .filter(Boolean)
        .map((employeeId) => {
          const entry = presenceByEmployee.get(employeeId);
          return {
            employeeId,
            isOnline: !!entry && entry.sockets.size > 0,
            lastSeenAt: entry?.lastSeenAt || null
          };
        });

      socket.emit('presence-status', { employees: statuses });
    });

    // Desktop app ready
    socket.on('desktop-app-ready', (data) => {
      const userId = data?.userId;
      if (userId) {
        socket.userId = userId;
        socket.join(`user:${userId}`);

        // CRITICAL FIX: Mark this socket as a desktop app
        socket.isDesktopApp = true;

        socket.emit('registration-confirmed', { status: 'ok', userId });
        console.log(`🖥️ [Socket.IO] Desktop app registered for user ${userId} (isDesktopApp=true)`);
      }
    });

    // Join a chat room
    socket.on('join-chat', (chatId) => {
      socket.join(`chat:${chatId}`);
      console.log(`👤 [Socket.IO] User ${socket.userId || socket.id} joined chat:${chatId}`);

      // Notify others in the room
      socket.to(`chat:${chatId}`).emit('user-joined', {
        userId: socket.userId,
        socketId: socket.id
      });
    });

    // Join a project room
    socket.on('join-project', (projectId) => {
      socket.join(`project:${projectId}`);
      console.log(`📂 [Socket.IO] User ${socket.userId || socket.id} joined project:${projectId}`);
    });

    // Leave a project room
    socket.on('leave-project', (projectId) => {
      socket.leave(`project:${projectId}`);
      console.log(`📂 [Socket.IO] User ${socket.userId || socket.id} left project:${projectId}`);
    });

    // Leave a chat room
    socket.on('leave-chat', (chatId) => {
      socket.leave(`chat:${chatId}`);
      console.log(`👋 [Socket.IO] User ${socket.userId || socket.id} left chat:${chatId}`);

      // Notify others in the room
      socket.to(`chat:${chatId}`).emit('user-left', {
        userId: socket.userId,
        socketId: socket.id
      });
    });

    // Handle new message (broadcast to room)
    socket.on('send-message', (data) => {
      const { chatId, message } = data;
      console.log(`💬 [Socket.IO] Broadcasting message to chat:${chatId}`);

      // Broadcast to all users in the chat room (including sender for confirmation)
      io.to(`chat:${chatId}`).emit('new-message', {
        chatId,
        message
      });
    });

    // Handle typing indicator
    socket.on('typing', (data) => {
      const { chatId, userId, userName } = data;
      socket.to(`chat:${chatId}`).emit('user-typing', {
        userId,
        userName,
        chatId
      });
    });

    // Handle stop typing
    socket.on('stop-typing', (data) => {
      const { chatId, userId } = data;
      socket.to(`chat:${chatId}`).emit('user-stop-typing', {
        userId,
        chatId
      });
    });

    // ========== MEETING ROOM HANDLERS ==========

    // Join a meeting room
    socket.on('join-meeting', (data) => {
      const { roomId, userId, userName } = data;
      socket.meetingRoom = roomId;
      socket.meetingUserId = userId;
      socket.meetingUserName = userName;

      socket.join(`meeting:${roomId}`);
      console.log(`📹 [Socket.IO] User ${userName} (${socket.id}) joined meeting:${roomId}`);

      // Notify others in the meeting room
      socket.to(`meeting:${roomId}`).emit('user-joined', {
        id: socket.id,
        userId: userId,
        userName: userName
      });

      // Send list of existing participants to the new user
      const room = io.sockets.adapter.rooms.get(`meeting:${roomId}`);
      if (room) {
        const existingParticipants = [];
        room.forEach((socketId) => {
          const participantSocket = io.sockets.sockets.get(socketId);
          if (participantSocket && participantSocket.id !== socket.id) {
            existingParticipants.push({
              id: participantSocket.id,
              userId: participantSocket.meetingUserId,
              userName: participantSocket.meetingUserName
            });
          }
        });
        if (existingParticipants.length > 0) {
          socket.emit('existing-participants', existingParticipants);
        }
      }
    });

    // Leave meeting room
    socket.on('leave-meeting', (data) => {
      const { roomId } = data;
      socket.leave(`meeting:${roomId}`);
      console.log(`📹 [Socket.IO] User ${socket.meetingUserName || socket.id} left meeting:${roomId}`);

      // Notify others
      socket.to(`meeting:${roomId}`).emit('user-left', {
        id: socket.id,
        userId: socket.meetingUserId,
        userName: socket.meetingUserName
      });
    });

    // WebRTC signaling: Offer
    socket.on('offer', (data) => {
      const { to, offer } = data;
      console.log(`📹 [Socket.IO] Relaying offer from ${socket.id} to ${to}`);
      io.to(to).emit('offer', {
        from: socket.id,
        offer: offer
      });
    });

    // WebRTC signaling: Answer
    socket.on('answer', (data) => {
      const { to, answer } = data;
      console.log(`📹 [Socket.IO] Relaying answer from ${socket.id} to ${to}`);
      io.to(to).emit('answer', {
        from: socket.id,
        answer: answer
      });
    });

    // WebRTC signaling: ICE Candidate
    socket.on('ice-candidate', (data) => {
      const { to, candidate } = data;
      io.to(to).emit('ice-candidate', {
        from: socket.id,
        candidate: candidate
      });
    });

    // Meeting chat message
    socket.on('meeting-chat', (data) => {
      const { roomId, message, userName, timestamp } = data;
      console.log(`💬 [Socket.IO] Meeting chat in ${roomId}: ${userName}: ${message}`);
      io.to(`meeting:${roomId}`).emit('meeting-chat', {
        message,
        userName,
        userId: socket.meetingUserId,
        timestamp: timestamp || new Date().toISOString()
      });
    });

    // Hand raise
    socket.on('raise-hand', (data) => {
      const { roomId } = data;
      socket.to(`meeting:${roomId}`).emit('hand-raised', {
        id: socket.id,
        userId: socket.meetingUserId,
        userName: socket.meetingUserName
      });
    });

    // Meeting reaction
    socket.on('meeting-reaction', (data) => {
      const { roomId, reaction } = data;
      io.to(`meeting:${roomId}`).emit('meeting-reaction', {
        id: socket.id,
        userName: socket.meetingUserName,
        reaction: reaction
      });
    });

    // ========== END MEETING ROOM HANDLERS ==========

    socket.on('disconnect', () => {
      console.log('❌ [Socket.IO] Client disconnected:', socket.id);

      // Clean up user presence by userId
      if (socket.userId) {
        const userId = socket.userId.toString();
        const userEntry = presenceByUserId.get(userId);
        if (userEntry) {
          userEntry.sockets.delete(socket.id);
          if (userEntry.sockets.size === 0) {
            userEntry.lastSeenAt = new Date();
            presenceByUserId.set(userId, userEntry);
          }
        }
      }

      if (socket.employeeId) {
        const employeeId = socket.employeeId.toString();
        const entry = presenceByEmployee.get(employeeId);
        if (entry) {
          entry.sockets.delete(socket.id);
          if (entry.sockets.size === 0) {
            entry.lastSeenAt = new Date();
            presenceByEmployee.set(employeeId, entry);
            io.emit('presence-update', {
              employeeId,
              isOnline: false,
              lastSeenAt: entry.lastSeenAt
            });
          }
        }
      }

      // If user was in a meeting, notify others
      if (socket.meetingRoom) {
        socket.to(`meeting:${socket.meetingRoom}`).emit('user-left', {
          id: socket.id,
          userId: socket.meetingUserId,
          userName: socket.meetingUserName
        });
        console.log(`📹 [Socket.IO] User ${socket.meetingUserName || socket.id} disconnected from meeting:${socket.meetingRoom}`);
      }
    });
  });

  server.listen(port, async (err) => {
    if (err) throw err;
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> Socket.IO server running on path: /api/socketio`);

    // Warm up database connections in background (don't block startup)
    if (dev) {
      console.log('🔥 Warming up database connections...');
      // Dynamic import for ESM module
      import('./lib/superadminDb.js').then(({ getSuperadminConnection }) => {
        getSuperadminConnection()
          .then(() => console.log('✅ Superadmin DB connection warmed'))
          .catch((e) => console.warn('⚠️ Superadmin DB warm-up skipped:', e.message));
      }).catch(() => { });
    }
  });
  
  // Graceful shutdown handling for Docker
  const gracefulShutdown = async (signal) => {
    console.log(`\n⚠️ Received ${signal}. Starting graceful shutdown...`);
    
    // Stop accepting new connections
    server.close(() => {
      console.log('✅ HTTP server closed');
    });
    
    // Close Socket.IO connections
    if (io) {
      console.log('🔌 Closing Socket.IO connections...');
      io.close(() => {
        console.log('✅ Socket.IO server closed');
      });
    }
    
    // Close database connections
    try {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.close();
        console.log('✅ MongoDB connection closed');
      }
      
      // Close tenant connections
      const { closeAllTenantConnections } = await import('./lib/tenantDb.js');
      await closeAllTenantConnections();
      console.log('✅ Tenant DB connections closed');
    } catch (error) {
      console.warn('⚠️ Error closing database connections:', error.message);
    }
    
    // Give time for cleanup, then exit
    setTimeout(() => {
      console.log('👋 Shutdown complete');
      process.exit(0);
    }, 2000);
  };
  
  // Handle Docker stop signals
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
});
