// Load environment variables from .env before any other code runs
require('dotenv').config();
process.env.TZ = 'Asia/Kolkata';

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = process.env.PORT || 3000;
let socketJwtSecret = null;

function getSocketJwtSecret() {
  if (!socketJwtSecret) {
    socketJwtSecret = new TextEncoder().encode(process.env.JWT_SECRET);
  }
  return socketJwtSecret;
}

async function verifySocketToken(token) {
  if (!token || !process.env.JWT_SECRET) return null;
  const { jwtVerify } = await import('jose');
  const { payload } = await jwtVerify(token, getSocketJwtSecret());
  return payload;
}

function getAllowedSocketOrigins() {
  return new Set(
    [
      process.env.NEXT_PUBLIC_APP_URL,
      process.env.PUBLIC_BASE_URL,
      ...(process.env.SOCKET_ALLOWED_ORIGINS || '').split(','),
    ]
      .map((origin) => origin?.trim().replace(/\/+$/, ''))
      .filter(Boolean)
  );
}

// ────────────────────────────────────────────────────────────────────────
// Boot-time environment validation.
// Fail fast when REQUIRED secrets are missing in production. In development
// we warn (so local devs can still run with partial config). Optional
// integrations are reported but not enforced.
// ────────────────────────────────────────────────────────────────────────
const REQUIRED_ENV_VARS = ['JWT_SECRET', 'MONGODB_URI'];
const RECOMMENDED_ENV_VARS = [
  'NEXT_PUBLIC_APP_URL',
  'CRON_SECRET',
  'SUPERADMIN_DB_NAME',
];
const OPTIONAL_INTEGRATIONS = [
  ['GEMINI_API_KEY', 'Gemini AI (set GEMINI_API_KEY_1..N for key rotation)'],
  ['IMAGEKIT_PUBLIC_KEY', 'ImageKit (legacy uploads)'],
  ['SMTP_HOST', 'Outbound email'],
  ['FCM_SERVER_KEY', 'Push notifications'],
  ['SENTRY_DSN', 'Error monitoring'],
];

(function validateEnvironment() {
  const missingRequired = REQUIRED_ENV_VARS.filter((k) => !process.env[k]);
  const missingRecommended = RECOMMENDED_ENV_VARS.filter((k) => !process.env[k]);
  const missingIntegrations = OPTIONAL_INTEGRATIONS.filter(([k]) => !process.env[k]);

  if (missingRequired.length > 0) {
    const msg = `❌ Missing REQUIRED env vars: ${missingRequired.join(', ')}`;
    if (dev) {
      console.warn(`[boot] ${msg} — continuing in dev, but APIs WILL fail.`);
    } else {
      console.error(`[boot] ${msg}`);
      console.error('[boot] Refusing to start in production with missing required secrets.');
      process.exit(1);
    }
  }
  if (missingRecommended.length > 0) {
    console.warn(`[boot] ⚠️  Missing recommended env vars: ${missingRecommended.join(', ')}`);
  }
  if (missingIntegrations.length > 0 && !dev) {
    console.warn('[boot] ℹ️  Optional integrations not configured:');
    for (const [, label] of missingIntegrations) console.warn(`        - ${label}`);
  }
  // Warn on insecure JWT secret
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    console.warn('[boot] ⚠️  JWT_SECRET is shorter than 32 chars — strongly recommend regenerating with `openssl rand -hex 32`.');
  }
  console.log('[boot] ✓ environment validation complete');
})();

// ── Startup Gemini key audit ──────────────────────────────────────────
// Collect all GEMINI_API_KEY_* env vars and log their status.
(function auditGeminiKeys() {
  const keyPattern = /^GEMINI_API_KEY_\d+$/i;
  const numbered = Object.keys(process.env)
    .filter((k) => keyPattern.test(k))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+$/)?.[0] || '0', 10);
      const nb = parseInt(b.match(/\d+$/)?.[0] || '0', 10);
      return na - nb;
    });

  const validKeys = [];
  const emptySlots = [];

  for (const k of numbered) {
    const v = (process.env[k] || '').trim();
    if (!v) {
      emptySlots.push(k);
    } else if (v.length >= 10) {
      validKeys.push({ slot: k, value: v });
    } else {
      console.warn(`[boot] ⚠️  ${k} is too short (${v.length} chars) — skipping.`);
    }
  }

  // Legacy fallback
  const legacy = (process.env.GEMINI_API_KEY || '').trim();
  if (legacy && legacy.length >= 10) {
    validKeys.push({ slot: 'GEMINI_API_KEY (legacy)', value: legacy });
  }

  console.log(`[boot] 🔑 Gemini keys: ${validKeys.length} loaded, ${emptySlots.length} empty`);
  if (validKeys.length === 0) {
    console.error('[boot] ❌ ZERO Gemini API keys configured. Get keys from https://aistudio.google.com/apikey');
  } else if (validKeys.length < 2) {
    console.warn('[boot] ⚠️  Only 1 Gemini key — rate-limit resilience is reduced.');
  }
  for (const vk of validKeys) {
    const masked = vk.value.length > 10 ? `${vk.value.slice(0, 6)}…${vk.value.slice(-2)}` : '***';
    console.log(`[boot]    ${vk.slot}=${masked}`);
  }
})();

// Latest desktop version – fetched from GitHub releases, refreshed every 5 min.
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'TechMW26';
const GITHUB_REPO_NAME = process.env.GITHUB_REPO || 'Talio';
const GITHUB_REPO = `${GITHUB_OWNER}/${GITHUB_REPO_NAME}`;
const FALLBACK_LATEST_DESKTOP = '5.0.5';
let latestDesktopVersion = FALLBACK_LATEST_DESKTOP;

async function refreshLatestDesktopVersion() {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Talio-Server',
          ...(process.env.GITHUB_TOKEN || process.env.GH_TOKEN
            ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN || process.env.GH_TOKEN}` }
            : {}),
        },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!res.ok) return;
    const release = await res.json();
    const version = release.tag_name?.replace(/^v/, '');
    if (version) latestDesktopVersion = version;
  } catch {
    // keep existing cached value
  }
}

// Refresh on startup + every 5 minutes
refreshLatestDesktopVersion();
setInterval(refreshLatestDesktopVersion, 5 * 60 * 1000);

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

// Initialize Next.js app (webpack mode for reliable compilation)
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Global socket instance
let io;
let isShuttingDown = false;

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

      // API response time logging (only for /api/ routes)
      if (parsedUrl.pathname?.startsWith('/api/')) {
        const startTime = Date.now();
        const originalEnd = res.end.bind(res);
        res.end = function (...args) {
          const duration = Date.now() - startTime;
          // Log slow APIs (>2s) with warning, all APIs in dev
          if (duration > 2000) {
            console.warn(`🐌 SLOW API [${duration}ms] ${req.method} ${parsedUrl.pathname}`);
          } else if (dev) {
            console.log(`⚡ API [${duration}ms] ${req.method} ${parsedUrl.pathname}`);
          }
          // Add timing header for debugging
          res.setHeader('X-Response-Time', `${duration}ms`);
          res.setHeader('Server-Timing', `total;dur=${duration}`);
          return originalEnd(...args);
        };
      }

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
      origin: (origin, callback) => {
        // Native clients do not send an Origin header. Browser clients must
        // match an explicitly configured application origin.
        if (!origin) return callback(null, true);
        const normalizedOrigin = origin.replace(/\/+$/, '');
        const isLocalDevelopment = dev && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalizedOrigin);
        if (isLocalDevelopment || getAllowedSocketOrigins().has(normalizedOrigin)) {
          return callback(null, true);
        }
        return callback(new Error('Socket origin is not allowed'));
      },
      methods: ['GET', 'POST'],
      credentials: false
    }
  });

  // Make io accessible globally (for API routes)
  global.io = io;

  // Verify handshake tokens once per connection. Employee identities are
  // resolved from tenant storage; guest identities are short-lived signed
  // tickets restricted to one meeting room.
  io.use(async (socket, nextSocket) => {
    const token = socket.handshake.auth?.token;
    if (!token) return nextSocket(new Error('Socket authentication required'));

    try {
      const payload = await verifySocketToken(token);
      if (
        payload?.type === 'meeting_guest' &&
        payload?.roomId &&
        payload?.guestId &&
        payload?.guestName &&
        payload?.tenantDatabaseName
      ) {
        socket.guestContext = {
          roomId: payload.roomId.toString(),
          guestId: payload.guestId.toString(),
          guestName: payload.guestName.toString().slice(0, 80),
          tenantDatabaseName: payload.tenantDatabaseName?.toString() || null,
        };
        return nextSocket();
      }

      if (!payload?.userId || !payload?.databaseName) {
        return nextSocket(new Error('Invalid socket session'));
      }

      const { getTenantModels } = await import('./lib/tenantModels.js');
      const { User, Employee } = await getTenantModels(payload.databaseName, ['User', 'Employee']);
      const user = await User.findById(payload.userId)
        .select('_id employeeId role isActive')
        .populate({ path: 'employeeId', select: '_id firstName lastName' })
        .lean();

      if (!user || user.isActive === false) {
        return nextSocket(new Error('Invalid socket session'));
      }

      const fallbackEmployee = user.employeeId
        ? null
        : await Employee.findOne({ userId: user._id })
          .select('_id firstName lastName')
          .lean();
      const resolvedEmployee = user.employeeId || fallbackEmployee;

      socket.authContext = {
        userId: user._id.toString(),
        employeeId: resolvedEmployee?._id?.toString() || null,
        displayName: [resolvedEmployee?.firstName, resolvedEmployee?.lastName].filter(Boolean).join(' '),
        role: user.role || payload.role || 'employee',
        tenantDatabaseName: payload.databaseName.toString(),
      };
      return nextSocket();
    } catch (error) {
      console.warn('[Socket.IO] Handshake authentication rejected:', error?.code || error?.message);
      return nextSocket(new Error('Invalid socket session'));
    }
  });

  io.on('connection', (socket) => {
    console.log('✅ [Socket.IO] Client connected:', socket.id);

    const registerAuthenticatedIdentity = () => {
      const auth = socket.authContext;
      if (!auth) return false;

      socket.userId = auth.userId;
      socket.employeeId = auth.employeeId;
      socket.tenantDatabaseName = auth.tenantDatabaseName;
      socket.join(`user:${socket.userId}`);
      socket.join(`tenant:${socket.tenantDatabaseName}`);

      const userEntry = presenceByUserId.get(socket.userId) || { sockets: new Set(), lastSeenAt: null };
      userEntry.sockets.add(socket.id);
      presenceByUserId.set(socket.userId, userEntry);

      if (socket.employeeId) {
        const employeeEntry = presenceByEmployee.get(socket.employeeId) || { sockets: new Set(), lastSeenAt: null };
        const wasOnline = employeeEntry.sockets.size > 0;
        employeeEntry.sockets.add(socket.id);
        presenceByEmployee.set(socket.employeeId, employeeEntry);

        if (!wasOnline) {
          io.emit('presence-update', {
            employeeId: socket.employeeId,
            isOnline: true,
            lastSeenAt: employeeEntry.lastSeenAt || null
          });
        }
      }

      return true;
    };

    const authorizeRoomJoin = async (roomType, resourceId) => {
      const auth = socket.authContext;
      if (!auth?.employeeId || !resourceId) return false;
      if (auth.role === 'admin') return true;

      try {
        const { getTenantModels } = await import('./lib/tenantModels.js');
        if (roomType === 'chat') {
          const { Chat } = await getTenantModels(auth.tenantDatabaseName, ['Chat']);
          return Boolean(await Chat.exists({ _id: resourceId, participants: auth.employeeId }));
        }

        const { Project, ProjectMember } = await getTenantModels(
          auth.tenantDatabaseName,
          ['Project', 'ProjectMember']
        );
        const [membership, ownership] = await Promise.all([
          ProjectMember.exists({
            project: resourceId,
            user: auth.employeeId,
            invitationStatus: 'accepted',
          }),
          Project.exists({
            _id: resourceId,
            $or: [
              { createdBy: auth.employeeId },
              { projectHead: auth.employeeId },
              { projectHeads: auth.employeeId },
            ],
          }),
        ]);
        return Boolean(membership || ownership);
      } catch (error) {
        console.warn(`[Socket.IO] ${roomType} room authorization failed:`, error.message);
        return false;
      }
    };

    const authorizeMeetingJoin = async (roomId) => {
      const guest = socket.guestContext;
      if (guest) return guest.roomId === String(roomId);

      const auth = socket.authContext;
      if (!auth?.employeeId || !roomId) return false;

      try {
        const { getTenantModel } = await import('./lib/tenantModels.js');
        const Meeting = await getTenantModel(auth.tenantDatabaseName, 'Meeting');
        return Boolean(await Meeting.exists({
          roomId: String(roomId),
          isLinkActive: true,
          $or: [
            { organizer: auth.employeeId },
            { 'invitees.employee': auth.employeeId },
          ],
        }));
      } catch (error) {
        console.warn(`[Socket.IO] Failed to authorize meeting:${roomId}:`, error.message);
        return false;
      }
    };

    registerAuthenticatedIdentity();

    // Authenticate user
    socket.on('authenticate', () => {
      if (!registerAuthenticatedIdentity()) {
        socket.emit('authentication-error', { message: 'Valid session required' });
        return;
      }
      socket.emit('authentication-confirmed', {
        userId: socket.userId,
        employeeId: socket.employeeId,
      });
    });

    // Join user-specific notification room (for desktop apps)
    socket.on('join-user-room', (userId) => {
      if (!socket.authContext || String(userId) !== socket.authContext.userId) return;
      socket.join(`user:${socket.authContext.userId}`);
    });

    // Presence requests from clients
    socket.on('presence-request', (data) => {
      if (!socket.authContext) return;
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
      const appVersion = data?.appVersion;
      if (registerAuthenticatedIdentity()) {
        const userId = socket.userId;

        // CRITICAL FIX: Mark this socket as a desktop app
        socket.isDesktopApp = true;
        socket.appVersion = appVersion;

        socket.emit('registration-confirmed', { status: 'ok', userId });
        console.log(`🖥️ [Socket.IO] Desktop app registered for user ${userId} v${appVersion || 'unknown'} (isDesktopApp=true)`);

        // If the desktop app is running an older version, tell it to check for updates
        if (appVersion && compareVersions(appVersion, latestDesktopVersion) < 0) {
          console.log(`🔄 [Socket.IO] Desktop app v${appVersion} is outdated (latest: ${latestDesktopVersion}), triggering update check`);
          socket.emit('trigger-update-check', { latestVersion: latestDesktopVersion });
        }
      }
    });

    // Join a chat room
    socket.on('join-chat', async (chatId) => {
      if (!await authorizeRoomJoin('chat', chatId)) {
        socket.emit('room-access-denied', { type: 'chat', resourceId: chatId });
        return;
      }
      socket.join(`chat:${chatId}`);
      console.log(`👤 [Socket.IO] User ${socket.userId || socket.id} joined chat:${chatId}`);

      // Notify others in the room
      socket.to(`chat:${chatId}`).emit('user-joined', {
        userId: socket.userId,
        socketId: socket.id
      });
    });

    // Join a project room
    socket.on('join-project', async (projectId) => {
      if (!await authorizeRoomJoin('project', projectId)) {
        socket.emit('room-access-denied', { type: 'project', resourceId: projectId });
        return;
      }
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
      if (!socket.rooms.has(`chat:${chatId}`)) return;
      console.log(`💬 [Socket.IO] Broadcasting message to chat:${chatId}`);

      // Broadcast to all users in the chat room (including sender for confirmation)
      io.to(`chat:${chatId}`).emit('new-message', {
        chatId,
        message
      });
    });

    // Handle typing indicator
    socket.on('typing', (data) => {
      const { chatId, userName } = data;
      if (!socket.rooms.has(`chat:${chatId}`)) return;
      socket.to(`chat:${chatId}`).emit('user-typing', {
        userId: socket.userId,
        userName,
        chatId
      });
    });

    // Handle stop typing
    socket.on('stop-typing', (data) => {
      const { chatId } = data;
      if (!socket.rooms.has(`chat:${chatId}`)) return;
      socket.to(`chat:${chatId}`).emit('user-stop-typing', {
        userId: socket.userId,
        chatId
      });
    });

    // ========== MEETING ROOM HANDLERS ==========

    // Join a meeting room
    socket.on('join-meeting', async (data, acknowledge) => {
      const { roomId, userName, isMuted, isScreenSharing } = data || {};
      const respond = typeof acknowledge === 'function' ? acknowledge : () => {};
      if (!roomId) {
        respond({ success: false, message: 'Meeting room is required' });
        return;
      }
      const normalizedRoomId = String(roomId);
      const guest = socket.guestContext;
      if (!await authorizeMeetingJoin(normalizedRoomId)) {
        socket.emit('meeting-access-denied', { roomId: normalizedRoomId });
        respond({ success: false, message: 'You do not have access to this meeting' });
        return;
      }

      const resolvedMeetingUserId = socket.authContext?.userId || guest.guestId;
      const resolvedMeetingUserName = guest
        ? `${guest.guestName} (Guest)`
        : socket.authContext.displayName || String(userName || 'Participant').slice(0, 80);
      const tenantDatabaseName = socket.authContext?.tenantDatabaseName || guest.tenantDatabaseName;
      const meetingRoom = `meeting:${tenantDatabaseName}:${normalizedRoomId}`;

      if (socket.meetingRoom && socket.meetingRoom !== meetingRoom) {
        socket.leave(socket.meetingRoom);
      }

      socket.meetingRoom = meetingRoom;
      socket.meetingRoomId = normalizedRoomId;
      socket.meetingUserId = resolvedMeetingUserId;
      socket.meetingUserName = resolvedMeetingUserName;
      socket.meetingIsMuted = Boolean(isMuted);
      socket.meetingIsScreenSharing = Boolean(isScreenSharing);

      socket.join(meetingRoom);
      console.log(`📹 [Socket.IO] User ${resolvedMeetingUserName} (${socket.id}) joined ${meetingRoom}`);

      // Notify others in the meeting room
      socket.to(meetingRoom).emit('user-joined', {
        id: socket.id,
        userId: resolvedMeetingUserId,
        userName: resolvedMeetingUserName,
        isMuted: socket.meetingIsMuted,
        isScreenSharing: socket.meetingIsScreenSharing
      });

      // Send list of existing participants to the new user
      const room = io.sockets.adapter.rooms.get(meetingRoom);
      if (room) {
        const existingParticipants = [];
        room.forEach((socketId) => {
          const participantSocket = io.sockets.sockets.get(socketId);
          if (participantSocket && participantSocket.id !== socket.id) {
            existingParticipants.push({
              id: participantSocket.id,
              userId: participantSocket.meetingUserId,
              userName: participantSocket.meetingUserName,
              isMuted: Boolean(participantSocket.meetingIsMuted),
              isScreenSharing: Boolean(participantSocket.meetingIsScreenSharing)
            });
          }
        });
        if (existingParticipants.length > 0) {
          socket.emit('existing-participants', existingParticipants);
        }
      }

      respond({ success: true });
    });

    // Leave meeting room
    socket.on('leave-meeting', (data) => {
      const { roomId } = data || {};
      if (!roomId || socket.meetingRoomId !== String(roomId) || !socket.meetingRoom) return;
      const meetingRoom = socket.meetingRoom;
      console.log(`📹 [Socket.IO] User ${socket.meetingUserName || socket.id} left ${meetingRoom}`);

      // Notify others
      socket.to(meetingRoom).emit('user-left', {
        id: socket.id,
        userId: socket.meetingUserId,
        userName: socket.meetingUserName
      });
      socket.leave(meetingRoom);
      socket.meetingRoom = null;
      socket.meetingRoomId = null;
      socket.meetingIsScreenSharing = false;
    });

    // WebRTC signaling: Offer
    socket.on('offer', (data) => {
      const { to, offer } = data || {};
      const targetSocket = io.sockets.sockets.get(to);
      if (!socket.meetingRoom || targetSocket?.meetingRoom !== socket.meetingRoom) return;
      console.log(`📹 [Socket.IO] Relaying offer from ${socket.id} to ${to}`);
      io.to(to).emit('offer', {
        from: socket.id,
        offer: offer
      });
    });

    // WebRTC signaling: Answer
    socket.on('answer', (data) => {
      const { to, answer } = data || {};
      const targetSocket = io.sockets.sockets.get(to);
      if (!socket.meetingRoom || targetSocket?.meetingRoom !== socket.meetingRoom) return;
      console.log(`📹 [Socket.IO] Relaying answer from ${socket.id} to ${to}`);
      io.to(to).emit('answer', {
        from: socket.id,
        answer: answer
      });
    });

    // WebRTC signaling: ICE Candidate
    socket.on('ice-candidate', (data) => {
      const { to, candidate } = data || {};
      const targetSocket = io.sockets.sockets.get(to);
      if (!socket.meetingRoom || targetSocket?.meetingRoom !== socket.meetingRoom) return;
      io.to(to).emit('ice-candidate', {
        from: socket.id,
        candidate: candidate
      });
    });

    // Keep microphone state synchronized for every participant.
    socket.on('meeting-mute-state', (data) => {
      const { roomId, isMuted } = data || {};
      if (!roomId || socket.meetingRoomId !== String(roomId) || !socket.meetingRoom) return;

      socket.meetingIsMuted = Boolean(isMuted);
      socket.to(socket.meetingRoom).emit('participant-mute-state', {
        id: socket.id,
        userId: socket.meetingUserId,
        isMuted: socket.meetingIsMuted
      });
    });

    // Keep screen-share state synchronized so every client can auto-pin it.
    socket.on('meeting-screen-share-state', (data) => {
      const { roomId, isScreenSharing } = data || {};
      if (!roomId || socket.meetingRoomId !== String(roomId) || !socket.meetingRoom) return;

      socket.meetingIsScreenSharing = Boolean(isScreenSharing);
      socket.to(socket.meetingRoom).emit('participant-screen-share-state', {
        id: socket.id,
        userId: socket.meetingUserId,
        isScreenSharing: socket.meetingIsScreenSharing
      });
    });

    // Meeting chat message
    socket.on('meeting-chat', (data, acknowledge) => {
      const { roomId, message } = data || {};
      const respond = typeof acknowledge === 'function' ? acknowledge : () => {};
      if (!roomId || socket.meetingRoomId !== String(roomId) || !socket.meetingRoom) {
        respond({ success: false, message: 'Join the meeting before sending messages' });
        return;
      }
      const normalizedMessage = typeof message === 'string' ? message.trim().slice(0, 4000) : '';
      if (!normalizedMessage) {
        respond({ success: false, message: 'Message cannot be empty' });
        return;
      }
      console.log(`💬 [Socket.IO] Meeting chat in ${roomId}: ${socket.meetingUserName}`);
      const outgoingMessage = {
        id: `${socket.id}:${Date.now()}`,
        message: normalizedMessage,
        userName: socket.meetingUserName,
        userId: socket.meetingUserId,
        senderSocketId: socket.id,
        timestamp: new Date().toISOString()
      };
      io.to(socket.meetingRoom).emit('meeting-chat', outgoingMessage);
      respond({ success: true, message: outgoingMessage });
    });

    // Hand raise
    socket.on('raise-hand', (data) => {
      const { roomId } = data || {};
      if (!roomId || socket.meetingRoomId !== String(roomId) || !socket.meetingRoom) return;
      socket.to(socket.meetingRoom).emit('hand-raised', {
        id: socket.id,
        userId: socket.meetingUserId,
        userName: socket.meetingUserName
      });
    });

    // Meeting reaction
    socket.on('meeting-reaction', (data) => {
      const { roomId, reaction } = data || {};
      if (!roomId || socket.meetingRoomId !== String(roomId) || !socket.meetingRoom) return;
      const emoji = typeof reaction === 'string' ? reaction : reaction?.emoji;
      const allowedReactions = new Set(['👍', '👏', '❤️', '😂', '😮', '🎉']);
      if (!allowedReactions.has(emoji)) return;

      socket.to(socket.meetingRoom).emit('meeting-reaction', {
        id: socket.id,
        userName: socket.meetingUserName,
        reaction: {
          id: Date.now(),
          emoji,
          sender: socket.meetingUserName
        }
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
        socket.to(socket.meetingRoom).emit('user-left', {
          id: socket.id,
          userId: socket.meetingUserId,
          userName: socket.meetingUserName
        });
        console.log(`📹 [Socket.IO] User ${socket.meetingUserName || socket.id} disconnected from ${socket.meetingRoom}`);
      }
    });
  });

  server.listen(port, async (err) => {
    if (err) throw err;
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> Socket.IO server running on path: /api/socketio`);

    // Warm up database connections in background (don't block startup)
    console.log('🔥 Warming up database connections...');
    // Dynamic import for ESM module
    import('./lib/superadminDb.js').then(({ getSuperadminConnection }) => {
      getSuperadminConnection()
        .then(() => console.log('✅ Superadmin DB connection warmed'))
        .catch((e) => console.warn('⚠️ Superadmin DB warm-up skipped:', e.message));
    }).catch(() => { });

    // Also warm up Redis cache connection
    import('./lib/cache.js').then(({ isRedisConnected }) => {
      isRedisConnected()
        .then((connected) => console.log(connected ? '✅ Redis connection warmed' : '⚠️ Redis not available, using memory cache'))
        .catch(() => { });
    }).catch(() => { });

    // Start background meeting finalizer + AI summary generation
    try {
      const { startMeetingFinalizerCron } = await import('./lib/meetingFinalizerCron.js');
      startMeetingFinalizerCron();
    } catch (e) { console.warn('⚠️ Meeting finalizer cron setup skipped:', e.message); }

    // Start in-process email queue drain (onboarding + project notifications)
    try {
      const { startEmailQueueCron } = require('./lib/emailQueueCron');
      startEmailQueueCron();
    } catch (e) { console.warn('⚠️ Email queue cron setup skipped:', e.message); }

    // Enforce 48-hour screenshot retention for productivity captures (legacy safety net).
    try {
      const { startProductivityScreenshotRetentionCron } = require('./lib/productivityScreenshotRetentionCron');
      startProductivityScreenshotRetentionCron();
    } catch (e) { console.warn('⚠️ Screenshot retention cron setup skipped:', e.message); }

    // End-of-day analyze + purge for productivity screenshots.
    try {
      const { startDailyProductivityCron } = require('./lib/dailyProductivityCron');
      startDailyProductivityCron();
    } catch (e) { console.warn('⚠️ Daily productivity cron setup skipped:', e.message); }

    // Fallback checker for latest GitHub release downloads.
    try {
      const { startLatestReleaseCron } = require('./lib/latestReleaseCron');
      startLatestReleaseCron();
    } catch (e) { console.warn('⚠️ Latest release cron setup skipped:', e.message); }
  });

  // Graceful shutdown handling for Docker
  const gracefulShutdown = async (signal) => {
    if (isShuttingDown) {
      console.log(`⚠️ Received ${signal} while graceful shutdown is already in progress`);
      return;
    }

    isShuttingDown = true;
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

    // Stop scheduled cron jobs
    try {
      const { stopMeetingFinalizerCron } = await import('./lib/meetingFinalizerCron.js');
      stopMeetingFinalizerCron();
    } catch (e) { /* ignore if not loaded */ }

    try {
      const { stopEmailQueueCron } = require('./lib/emailQueueCron');
      stopEmailQueueCron();
    } catch (e) { /* ignore if not loaded */ }

    try {
      const { stopProductivityScreenshotRetentionCron } = require('./lib/productivityScreenshotRetentionCron');
      stopProductivityScreenshotRetentionCron();
    } catch (e) { /* ignore if not loaded */ }

    try {
      const { stopDailyProductivityCron } = require('./lib/dailyProductivityCron');
      stopDailyProductivityCron();
    } catch (e) { /* ignore if not loaded */ }

    try {
      const { stopLatestReleaseCron } = require('./lib/latestReleaseCron');
      stopLatestReleaseCron();
    } catch (e) { /* ignore if not loaded */ }

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
  process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.once('SIGINT', () => gracefulShutdown('SIGINT'));
});
