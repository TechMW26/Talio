# Talio - AI Agent Instructions

## 🧠 Project Overview
Talio is a comprehensive workforce management platform built with **Next.js 14 (App Router)**, **MongoDB**, and a **Custom Node.js Server** for real-time capabilities. It features an AI assistant named "MAYA" and productivity monitoring tools.

## 🏗 Architecture & Core Components

### 1. Application Structure
- **Framework**: Next.js 14 with App Router (`app/` directory).
- **Server**: Custom `server.js` entry point. **CRITICAL**: This initializes both Next.js and **Socket.IO**.
- **Database**: MongoDB accessed via Mongoose (`models/`).
- **Real-time**: Socket.IO is initialized in `server.js` and attached to `global.io` for access in API routes.
- **Mobile**: Native Android application located in `android/`.
- **AI**: "MAYA" assistant logic resides in `app/api/maya/` and uses vector search/LLMs.

### 2. Key Directories
- `app/api/`: Backend API routes. Organized by domain (e.g., `attendance`, `leave`, `payroll`).
- `models/`: Mongoose schemas.
- `components/`: React components.
- `scripts/`: Database migration and setup scripts.
- `android/`: Native Android project files (Gradle based).
- `windows-app/`: Electron desktop app for productivity monitoring.
- `public/uploads/captures/`: Screenshot storage from desktop app.
- `public/`: Static assets.

### 3. Desktop App (Electron)
Located in `windows-app/`, the Electron app provides:
- White-themed UI with login screen
- Automatic screenshot capture every 1 minute after check-in
- Keyboard/mouse activity tracking
- System tray integration with auto-start
- Screenshots saved to `uploads/captures/{EmployeeName}/{EmployeeCode}/{timestamp}.webp`
- Uses `/api/productivity/capture` endpoint for uploads

## 🛠 Development Workflows

### Starting the Server
**DO NOT** use `next dev` directly.
- **Dev**: `npm run dev` (Runs `node server.js` with dev flags).
- **Prod**: `npm start` (Runs `node server.js` in production mode).

### Database & Migrations
- Mongoose models are the source of truth for data structure.
- Use scripts in `scripts/` for migrations and seeding (e.g., `npm run seed`, `npm run migrate`).
- **Fix Scripts**: The root directory contains many `fix-*.js` and `check-*.js` scripts. Use these for diagnosing specific issues (e.g., `node fix-admin-login.js`).

### Deployment
- Use the provided shell scripts for deployment tasks:
  - `deploy.sh`: General deployment.
  - `deploy-production.sh`: Production deployment.
  - `build-apk-app.sh`: Build the Android app.

### Building Desktop App
```bash
cd windows-app
npm install
npm run build        # Windows
npm run build:mac    # macOS
npm run build:linux  # Linux
```

## 🧩 Coding Conventions

### Backend (API Routes)
- **Socket.IO**: To emit events from an API route, use `global.io`.
  ```javascript
  // Example
  if (global.io) {
    global.io.to(`user:${userId}`).emit('notification', { ... });
  }
  ```
- **Authentication**: Uses JWT and NextAuth. Verify tokens in API routes before processing sensitive actions.

### Frontend (React/Next.js)
- **Styling**: Tailwind CSS.
- **State**: React Context and Hooks.
- **Real-time**: Listen for Socket.IO events in client components (e.g., `useEffect` with socket client).

### AI (MAYA)
- MAYA actions are mapped to database operations.
- When modifying core logic, ensure MAYA's context/vector search capabilities are updated if necessary.

## ⚠️ Critical Implementation Details
- **Custom Server**: Because of `server.js`, Vercel-specific features (like serverless functions) might behave differently. The app is designed to run as a long-running Node.js process.
- **Environment Variables**: Critical for DB connection, Auth secrets, and AI keys. Ensure `.env` is properly loaded.
- **Android Integration**: Changes to push notifications (FCM) often require updates in both the web backend (`app/api/fcm/`) and the Android codebase (`android/`).
