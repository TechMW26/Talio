# Talio - AI Agent Instructions

## Architecture (CRITICAL)
**Custom Server**: Always use `npm run dev` (not `next dev`) — [server.js](../server.js) initializes Socket.IO alongside Next.js. `global.io` is available in API routes.

**Tech Stack**: Next.js 15 (App Router), MongoDB/Mongoose, Socket.IO, TailwindCSS, AI (Gemini → OpenAI fallback)

## Core Patterns

### API Routes ([app/api/](../app/api/))
```javascript
import connectDB from '@/lib/mongodb'
import { verifyToken } from '@/lib/auth'

export async function POST(request) {
  await connectDB()                                              // Always connect first
  const token = request.headers.get('authorization')?.split(' ')[1]
  const payload = await verifyToken(token)                       // JWT auth
  // ... logic
  if (global.io) global.io.to(`user:${userId}`).emit('event', data)  // Real-time
}
```

### Mongoose Models ([models/](../models/))
**Always use this pattern** to prevent HMR recompilation errors:
```javascript
export default mongoose.models.ModelName || mongoose.model('ModelName', schema)
```

### Socket.IO
- **Server**: `global.io.to('user:${userId}').emit('event', data)` — always check `if (global.io)` first
- **Client**: [contexts/SocketContext.js](../contexts/SocketContext.js) manages connection
- **Auth**: Socket uses `User._id` (NOT `employeeId`) — see [SocketContext.js#L21](../contexts/SocketContext.js)

### AI Integration ([lib/gemini.js](../lib/gemini.js))
```javascript
import { generateContent, generateVisionContent } from '@/lib/gemini'
const text = await generateContent(prompt, systemInstruction)     // Gemini → OpenAI fallback
const analysis = await generateVisionContent(prompt, images)      // Vision tasks
```

## RBAC Roles ([models/User.js](../models/User.js))
`admin` > `department_head` > `hr` > `manager` > `employee`

## Key Commands
| Task | Command |
|------|---------|
| Development | `npm run dev` (NOT `next dev`) |
| Build | `npm run build` |
| Production | `npm start` |
| DB Migration | `npm run migrate` |
| Debug DB | `node check-db-status.js` |

## Common Pitfalls
1. **Using `next dev`** breaks Socket.IO — always use `npm run dev`
2. **Socket auth** uses `User._id`, not `employeeId`
3. **Missing `global.io` check** causes crashes if socket not ready
4. **Env file**: Use `.env` (not `.env.local`)
5. **Public routes**: Add exceptions in [middleware.js](../middleware.js) `publicRoutes`/`publicApiRoutes` arrays

## Key Files
- [server.js](../server.js) — Entry point (Socket.IO + Next.js)
- [middleware.js](../middleware.js) — Auth & route protection
- [lib/mongodb.js](../lib/mongodb.js) — DB connection with auto-retry
- [lib/auth.js](../lib/auth.js) — JWT utilities (`verifyToken`, `verifyTokenFromRequest`)
- [contexts/SocketContext.js](../contexts/SocketContext.js) — Client socket management
