import { Server } from 'socket.io'

let io
const presenceByEmployee = new Map()

export const initSocket = (server) => {
  if (!io) {
    io = new Server(server, {
      path: '/api/socketio',
      addTrailingSlash: false,
      cors: {
        origin: (origin, callback) => {
          // Allow connections with no origin (mobile apps, curl, etc.)
          const allowedOrigin = process.env.NEXT_PUBLIC_APP_URL || '*';
          if (!origin || allowedOrigin === '*' || origin === allowedOrigin) {
            callback(null, true);
          } else {
            callback(null, true); // Allow all origins for Socket.IO (auth handled via token)
          }
        },
        methods: ['GET', 'POST'],
        credentials: false
      }
    })

    io.on('connection', (socket) => {
      console.log('✅ [Socket.IO] Client connected:', socket.id)

      // Authenticate user
      socket.on('authenticate', (payload) => {
        const resolvedUserId = typeof payload === 'object' ? payload?.userId || payload?.id : payload
        const resolvedEmployeeId = typeof payload === 'object' ? payload?.employeeId : null

        if (resolvedUserId) {
          socket.userId = resolvedUserId.toString()
          socket.join(`user:${socket.userId}`)
          console.log(`🔐 [Socket.IO] User ${socket.userId} authenticated`)
        }

        if (resolvedEmployeeId) {
          const employeeId = resolvedEmployeeId.toString()
          socket.employeeId = employeeId
          const entry = presenceByEmployee.get(employeeId) || { sockets: new Set(), lastSeenAt: null }
          const wasOnline = entry.sockets.size > 0
          entry.sockets.add(socket.id)
          presenceByEmployee.set(employeeId, entry)

          if (!wasOnline) {
            io.emit('presence-update', {
              employeeId,
              isOnline: true,
              lastSeenAt: entry.lastSeenAt || null
            })
          }
        }
      })

      // Join user-specific notification room (for desktop apps)
      socket.on('join-user-room', (userId) => {
        socket.userId = userId
        socket.join(`user:${userId}`)
        console.log(`🔔 [Socket.IO] User ${userId} joined notification room`)
      })

      // Presence requests from clients
      socket.on('presence-request', (data) => {
        const employeeIds = Array.isArray(data?.employeeIds) ? data.employeeIds : []
        const statuses = employeeIds
          .map(id => id?.toString?.())
          .filter(Boolean)
          .map(employeeId => {
            const entry = presenceByEmployee.get(employeeId)
            return {
              employeeId,
              isOnline: !!entry && entry.sockets.size > 0,
              lastSeenAt: entry?.lastSeenAt || null
            }
          })

        socket.emit('presence-status', { employees: statuses })
      })

      // Desktop app ready
      socket.on('desktop-app-ready', (data) => {
        const userId = data?.userId
        if (userId) {
          socket.userId = userId
          socket.join(`user:${userId}`)
          socket.emit('registration-confirmed', { status: 'ok', userId })
          console.log(`🖥️ [Socket.IO] Desktop app registered for user ${userId}`)
        }
      })

      // Join a chat room
      socket.on('join-chat', (chatId) => {
        socket.join(`chat:${chatId}`)
        console.log(`👤 [Socket.IO] User ${socket.userId || socket.id} joined chat:${chatId}`)

        // Notify others in the room
        socket.to(`chat:${chatId}`).emit('user-joined', {
          userId: socket.userId,
          socketId: socket.id
        })
      })

      // Leave a chat room
      socket.on('leave-chat', (chatId) => {
        socket.leave(`chat:${chatId}`)
        console.log(`👋 [Socket.IO] User ${socket.userId || socket.id} left chat:${chatId}`)

        // Notify others in the room
        socket.to(`chat:${chatId}`).emit('user-left', {
          userId: socket.userId,
          socketId: socket.id
        })
      })

      // Handle new message (broadcast to room)
      socket.on('send-message', (data) => {
        const { chatId, message } = data
        console.log(`💬 [Socket.IO] Broadcasting message to chat:${chatId}`)

        // Broadcast to all users in the chat room (including sender for confirmation)
        io.to(`chat:${chatId}`).emit('new-message', {
          chatId,
          message
        })
      })

      // Handle typing indicator
      socket.on('typing', (data) => {
        const { chatId, userId, userName } = data
        socket.to(`chat:${chatId}`).emit('user-typing', {
          userId,
          userName,
          chatId
        })
      })

      // Handle stop typing
      socket.on('stop-typing', (data) => {
        const { chatId, userId } = data
        socket.to(`chat:${chatId}`).emit('user-stop-typing', {
          userId,
          chatId
        })
      })

      // Handle message read status
      socket.on('mark-read', (data) => {
        const { chatId, messageId, userId } = data
        socket.to(`chat:${chatId}`).emit('message-read', {
          chatId,
          messageId,
          userId
        })
      })

      // Handle disconnect
      socket.on('disconnect', () => {
        console.log('❌ [Socket.IO] Client disconnected:', socket.id)

        if (socket.employeeId) {
          const employeeId = socket.employeeId.toString()
          const entry = presenceByEmployee.get(employeeId)
          if (entry) {
            entry.sockets.delete(socket.id)
            if (entry.sockets.size === 0) {
              entry.lastSeenAt = new Date()
              presenceByEmployee.set(employeeId, entry)
              io.emit('presence-update', {
                employeeId,
                isOnline: false,
                lastSeenAt: entry.lastSeenAt
              })
            }
          }
        }
      })

      // Handle errors
      socket.on('error', (error) => {
        console.error('⚠️ [Socket.IO] Socket error:', error)
      })
    })

    console.log('🚀 [Socket.IO] Server initialized successfully')
  }

  return io
}

export const getIO = () => {
  if (!io) {
    throw new Error('Socket.IO not initialized')
  }
  return io
}

// Helper function to emit to specific chat
export const emitToChat = (chatId, event, data) => {
  if (io) {
    io.to(`chat:${chatId}`).emit(event, data)
    console.log(`📤 [Socket.IO] Emitted ${event} to chat:${chatId}`)
  }
}

// Helper function to emit to specific user
export const emitToUser = (userId, event, data) => {
  if (io) {
    io.to(`user:${userId}`).emit(event, data)
    console.log(`📤 [Socket.IO] Emitted ${event} to user:${userId}`)
  }
}

