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

  // Initialize Socket.IO
  io = new Server(server, {
    path: '/api/socketio',
    addTrailingSlash: false,
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
    socket.on('authenticate', (userId) => {
      socket.userId = userId;
      socket.join(`user:${userId}`);
      console.log(`🔐 [Socket.IO] User ${userId} authenticated`);
    });

    // Join user-specific notification room (for desktop apps)
    socket.on('join-user-room', (userId) => {
      socket.userId = userId;
      socket.join(`user:${userId}`);
      console.log(`🔔 [Socket.IO] User ${userId} joined notification room`);
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

    socket.on('disconnect', () => {
      console.log('❌ [Socket.IO] Client disconnected:', socket.id);
    });
  });

  server.listen(port, (err) => {
    if (err) throw err;
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> Socket.IO server running on path: /api/socketio`);
  });
});
