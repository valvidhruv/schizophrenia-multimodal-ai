Files Created/Modified:
1. backend/src/main.ts - Created minimal Express server with health endpoint
2. backend/tsconfig.json - Updated outDir to /app/dist to match Dockerfile expectations

Key Implementation Details:
- Minimal Express server using only specified dependencies
- GET /health endpoint returns HTTP 200 with JSON status
- GET /api/health endpoint for frontend consistency
- Graceful startup/shutdown handling
- TypeScript compilation succeeds (npm run build)
- Development server runs (npm run dev) on port 3001

Verification Results:
✅ TypeScript compilation succeeds
✅ Development server starts successfully
✅ Dockerfile build context compatible
✅ Health endpoint returns HTTP 200 with JSON response

Commands to run from project root:
1. cd backend && npm install
2. cd backend && npm run build
3. cd backend && npm run dev