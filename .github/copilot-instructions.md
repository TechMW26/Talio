# Talio - AI Agent Instructions

## 🧠 Project Overview
Talio is a comprehensive workforce management platform built with **Next.js 14 (App Router)**, **MongoDB**, and a **Custom Node.js Server** for real-time capabilities. It features an AI assistant and productivity monitoring tools for HR operations.

## 🏗 Architecture & Critical Patterns

### Custom Server Architecture (CRITICAL)
**NEVER use `next dev` directly** - This project uses a custom Node.js server that wraps Next.js:
```bash
npm run dev   # Runs: node server.js (with dev flags)
npm start     # Production: node server.js
```

**Why**: `server.js` initializes Socket.IO alongside Next.js. The Socket.IO instance is attached to `global.io` for use throughout the application. Using `next dev` will break real-time functionality.

### Database Patterns
- **Connection**: Mongoose with connection caching in `lib/mongodb.js`. Always use `connectDB()` before DB operations.
- **Auto-Retry**: Built-in retry logic (up to 3 attempts) for authentication failures - no manual retry needed in API routes.
- **Connection Health**: Automatic stale connection detection and cleanup, concurrent connection prevention.
- **Models**: Located in `models/`. Use pattern: `mongoose.models.ModelName || mongoose.model('ModelName', schema)` to prevent recompilation errors in dev mode.
- **Migration Scripts**: Use `scripts/` for DB changes. Never manually edit production DB. Run `npm run migrate` for schema updates.
- **Diagnostic Tools**: Root contains `fix-*.js` and `check-*.js` scripts for troubleshooting (e.g., `node check-db-status.js`).

### Real-time Communication (Socket.IO)
**Server-side** (API routes):
```javascript
// Emit to specific user
if (global.io) {
  global.io.to(`user:${userId}`).emit('meeting-invite', data);
}

// Broadcast to room
global.io.to(`chat:${chatId}`).emit('new-message', message);
```

**Client-side** (React components):
- Socket context in `contexts/SocketContext.js` manages connection
- Socket authenticates users via `authenticate` event with userId (User._id, NOT employeeId)
- Desktop apps use `desktop-app-ready` event and set `socket.isDesktopApp = true`

### Authentication Patterns
- **JWT**: Primary auth via `lib/auth.js`. Extract token from `Authorization: Bearer <token>` header.
- **Pattern**: 
  ```javascript
  import { verifyToken } from '@/lib/auth'
  const token = request.headers.get('authorization')?.split(' ')[1]
  const payload = await verifyToken(token)
  ```
- **Middleware**: `middleware.js` protects routes. Public routes defined in `publicRoutes` and `publicApiRoutes` arrays.
- **User Model**: Located in `models/User.js`. Contains `role` field (admin/hr/manager/employee/department_head) for RBAC.

### AI Integration (Gemini/OpenAI)
- **Location**: `lib/gemini.js` contains AI helpers
- **Pattern**: Fallback chain - tries Gemini models first, falls back to OpenAI (gpt-4o-mini) if Gemini fails
- **Usage**: `generateContent(prompt, systemInstruction)` for text, `generateVisionContent(prompt, images)` for vision tasks
- **Productivity Analysis**: `/api/productivity/sessions/[id]/analyze/route.js` uses vision API for screenshot analysis

## 📁 Directory Structure & Domain Organization

### API Routes (`app/api/`)
Organized by domain (attendance, leave, payroll, etc.). Each exports HTTP methods:
```javascript
export async function GET(request) { }
export async function POST(request) { }
```
**Pattern**: Always connect to DB first, verify auth, then execute logic.

### Key Modules
- `attendance/`: Check-in/out, overtime, corrections, geolocation
- `leave/`: Applications, approvals, balance management
- `payroll/`: Salary processing, payslip generation
- `productivity/`: Screenshot capture, session management, AI analysis
- `meetings/`: Scheduling, transcription (OpenAI Whisper), summarization
- `projects/`: Task management, approval workflows, timeline events
- `notifications/`: Push notifications, in-app alerts, FCM integration

### Frontend Structure
- `components/`: Reusable UI components (Tailwind CSS)
- `contexts/`: React contexts (SocketContext, ThemeContext, InAppNotificationContext)
- `hooks/`: Custom hooks (useDashboardLayout, useGeofencing)
- `app/`: Next.js App Router pages and layouts

### Native Apps
- `android/`: React Native Android app (Gradle-based, build with `./build-apk.sh`)
- `desktop-app/`: Electron app for Windows/macOS/Linux productivity monitoring
  - Captures screenshots every 1 minute when clocked in
  - Saves to `public/uploads/captures/{EmployeeName}/{EmployeeCode}/{timestamp}.webp`
  - **Role restriction**: Admin screens NEVER captured

## 🛠 Common Development Tasks

### Adding a New API Route
1. Create route file in `app/api/<domain>/route.js`
2. Import `connectDB` and required models
3. Implement HTTP method exports (GET/POST/PUT/DELETE)
4. Use `verifyToken` for auth
5. Emit Socket.IO events if real-time updates needed

### Database Changes
1. Modify/create model in `models/`
2. Create migration script in `scripts/` if needed
3. Test with `check-db-status.js` before deploying
4. Run `npm run migrate` in production

### Real-time Features
1. Server: Emit via `global.io.to(`user:${userId}`).emit('event', data)`
2. Client: Listen in `SocketContext.js` or component via `socket.on('event', handler)`
3. Test with `scripts/test-notifications.js`

### Debugging
- **DB Issues**: Run `node check-db-state.js` or `node check-db-status.js`
- **Auth Issues**: Check `middleware.js` public route exceptions
- **Socket Issues**: Verify server started with `node server.js` (not `next dev`)
- **AI Issues**: Run `node validate-openai-key.js` or check Gemini API key

## 🔐 Security & RBAC

### Role Hierarchy
- `admin`: Company admin (full access, manage all users/data)
- `department_head`: Manage department employees only
- `hr`: Employee management, payroll access
- `manager`: Team view, approvals
- `employee`: Self-service only

### Productivity Monitoring Privacy
- **Role-based visibility**: Only admin/department_head can view productivity data
- **Admin exclusion**: Admin role screens are NEVER captured (enforced in desktop app)
- **Work hours only**: Captures only occur during active check-in status

## 📦 Environment Variables (.env)
Critical variables (see `.env.example`):
- `MONGODB_URI`: MongoDB connection string (Atlas or local)
- `JWT_SECRET`: JWT signing secret
- `NEXTAUTH_URL`: App URL for NextAuth
- `GEMINI_API_KEY` / `OPENAI_API_KEY`: AI service keys
- `EMAIL_*`: SMTP configuration for notifications
- `GOOGLE_CLIENT_ID/SECRET`: Google OAuth for sign-in/Gmail integration

## 🚀 Deployment

### Standard Deployment
```bash
./deploy-production.sh  # Uses Docker Compose
```

### Manual Deployment
```bash
npm install
npm run build           # Next.js build
npm start               # Starts node server.js
```

### Docker Notes
- `Dockerfile` builds production image
- `docker-compose.yml` for standard deployment
- `docker-compose.ssl.yml` for SSL/HTTPS with nginx
- Nginx configs in `nginx.conf` and `nginx.ssl.conf`

### Android App Build
```bash
cd android
./build-apk.sh          # Builds release APK
```

### Desktop App Build
```bash
cd desktop-app
npm install
npm run build           # Windows .exe
npm run build:mac       # macOS .dmg
npm run build:linux     # Linux AppImage
```

## ⚠️ Common Pitfalls

1. **Using `next dev`**: Always use `npm run dev` to start custom server with Socket.IO
2. **Model recompilation**: Use `mongoose.models.X || mongoose.model()` pattern to avoid HMR errors
3. **User vs Employee ID**: Socket auth uses `User._id`, NOT `employeeId` (ObjectId reference)
4. **Missing `global.io` check**: Always check `if (global.io)` before emitting events
5. **Environment variables**: Copy `.env.example` to `.env` and fill actual values (`.env.local` NOT used)
6. **Build errors**: Set `typescript.ignoreBuildErrors: true` in `next.config.js` for Docker builds
7. **File uploads**: Max size 10MB, configured in `next.config.js` experimental settings

## 📚 Key Files Reference

- `server.js`: Entry point (Socket.IO + Next.js initialization)
- `middleware.js`: Auth middleware & route protection
- `lib/mongodb.js`: Database connection with caching
- `lib/auth.js`: JWT verification utilities
- `lib/gemini.js`: AI integration (Gemini/OpenAI fallback)
- `contexts/SocketContext.js`: Client-side Socket.IO management
- `models/User.js`: User authentication & RBAC
- `models/Employee.js`: Employee profiles & HR data
- `.env.example`: Environment variable template
