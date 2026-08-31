// Vercel Cron invokes GET requests. Keep the existing POST endpoint available
// for legacy schedulers while exposing the same job through this GET route.
export { POST as GET } from '../route'

