#!/usr/bin/env node
'use strict'

// Real loopback HTTP acceptance over an exact, newly owned Atlas namespace.
// Never point a production server at this catalog or seed production identities.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const net = require('node:net')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { randomBytes, createHash } = require('node:crypto')
const { gzipSync } = require('node:zlib')
const { once } = require('node:events')
const { pack } = require('../../lib/platform/firestoreCodec.cjs')
const { plan: targetPlan, applicationModule } = require('./acceptance.cjs')
const root = path.resolve(__dirname, '../..')
const id = () => randomBytes(12).toString('hex')

function childEnvironment(env, dataset, port) {
  if (!/^http-acceptance-[a-f0-9]{24}$/.test(dataset) || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('ISOLATED_HTTP_NAMESPACE_AND_PORT_REQUIRED')
  const output = { ...env }
  for (const key of Object.keys(output)) if (/^(FIREBASE_|FIRESTORE_|BLOB_|PUSHER_|REDIS_|UPSTASH_|LIVEKIT_|EMAIL_|SMTP_|LINKEDIN_|GOOGLE_|OPENAI_|ANTHROPIC_|GEMINI_|DEEPSEEK_|RAZORPAY_|TWILIO_|QSTASH_|CRON_SECRET)/.test(key)) output[key] = ''
  return { ...output, NODE_ENV: 'development', VERCEL: '0', TALIO_DATABASE_PROVIDER: 'mongodb', MONGODB_DATASET: dataset, TALIO_LOCAL_ACCEPTANCE: '1', TALIO_MIGRATION_FREEZE: '0', JWT_SECRET: randomBytes(48).toString('hex'), NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${port}`, NEXT_DIST_DIR: `.next-dev-${port}`, TZ: 'Asia/Kolkata', NEXT_TELEMETRY_DISABLED: '1', SKIP_ENV_VALIDATION: 'true' }
}
async function availablePort() {
  const server = net.createServer()
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
async function request(base, endpoint, options = {}) {
  return fetch(`${base}${endpoint}`, { redirect: 'manual', ...options, signal: AbortSignal.timeout(90000) })
}
async function stopServer(child) {
  if (!child || child.exitCode !== null) return
  const closed = once(child, 'close').catch(() => {})
  try { process.kill(-child.pid, 'SIGTERM') } catch {}
  const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch {} }, 10000)
  await closed; clearTimeout(timer)
}

async function run(env, argv) {
  const target = targetPlan(env, argv)
  if (!target.execute) { console.log(JSON.stringify({ event: 'http-acceptance-plan-only', writes: 0, target })); return }
  const { MongoClient } = require('mongodb'), bcrypt = require('bcryptjs')
  const { encodeMongoRecord } = applicationModule(path.join(root, 'lib/platform/mongoStore.server.js'))
  const dataset = `http-acceptance-${id()}`, tenantA = `talio_company_http_a_${id()}`, tenantB = `talio_company_http_b_${id()}`
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'talio-http-acceptance-')); fs.chmodSync(directory, 0o700)
  const manifestFile = path.join(directory, 'run.json'), logFile = path.join(directory, 'server.log')
  const saveManifest = value => fs.writeFileSync(manifestFile, JSON.stringify({ dataset, target, ...value }), { mode: 0o600 })
  saveManifest({ status: 'starting', startedAt: new Date().toISOString() })
  const client = new MongoClient(env.MONGODB_URI, { appName: 'talio-isolated-http-acceptance', maxPoolSize: 3, minPoolSize: 0, promoteBuffers: true, serverSelectionTimeoutMS: 15000 })
  let db, child, ownsNamespace = false, failure, passed = false, logFd
  const checks = []
  try {
    await client.connect(); db = client.db(target.databaseName)
    assert.equal(await db.collection('talio_records').countDocuments({ dataset }), 0)
    assert.equal(await db.collection('talio_unique_keys').countDocuments({ dataset }), 0)
    assert.equal(await db.collection('talio_catalogs').countDocuments({ _id: dataset }), 0)
    ownsNamespace = true
    const password = randomBytes(24).toString('hex'), passwordHash = await bcrypt.hash(password, 10)
    const userA = id(), employeeA = id(), userB = id(), employeeB = id(), companyA = id(), companyB = id(), projectId = id(), taskId = id(), imageId = id(), attendanceId = id()
    const emailA = `${id()}@example.invalid`, emailB = `${id()}@example.invalid`, now = new Date()
    const records = []
    const add = (databaseName, collectionName, record, envelopeMetadata = {}) => records.push(encodeMongoRecord({ dataset, databaseName, collectionName, record, envelopeMetadata }))
    for (const fixture of [{ databaseName: tenantA, user: userA, employee: employeeA, company: companyA, email: emailA }, { databaseName: tenantB, user: userB, employee: employeeB, company: companyB, email: emailB }]) {
      add('talio_superadmin', 'tenantcompanies', { _id: fixture.company, name: 'Isolated acceptance', slug: fixture.company, databaseName: fixture.databaseName, isActive: true, serviceStatus: 'active', isSetupComplete: true })
      add('talio_superadmin', 'usertenantmappings', { _id: id(), email: fixture.email, userId: fixture.user, tenantCompanyId: fixture.company, databaseName: fixture.databaseName, companyName: 'Isolated acceptance', companySlug: fixture.company, role: 'admin', isActive: true, loginCount: 0 })
      add(fixture.databaseName, 'users', { _id: fixture.user, email: fixture.email, password: passwordHash, role: 'admin', employeeId: fixture.employee, isActive: true, authVersion: 0, createdAt: now, updatedAt: now })
      add(fixture.databaseName, 'employees', { _id: fixture.employee, userId: fixture.user, firstName: 'Acceptance', lastName: 'Only', email: fixture.email, employeeCode: 'TEST', isActive: true, status: 'active', dateOfJoining: now, createdAt: now, updatedAt: now })
      add(fixture.databaseName, 'companysettings', { _id: id(), notifications: { emailNotifications: false, emailEvents: { login: false } }, timezone: 'Asia/Kolkata' })
    }
    const systemStatuses = [['todo', 'To Do', 'gray'], ['in-progress', 'In Progress', 'blue'], ['review', 'Review', 'purple'], ['completed', 'Completed', 'green'], ['completed-pending-approval', 'Pending Approval', 'amber'], ['rejected', 'Rejected', 'red'], ['blocked', 'Blocked', 'orange'], ['archived', 'Archived', 'gray']].map(([key, label, color], order) => ({ key, label, color, order, isSystem: true }))
    add(tenantA, 'projects', { _id: projectId, name: 'Acceptance dynamic board', status: 'active', projectHead: employeeA, projectHeads: [employeeA], createdBy: employeeA, taskStatuses: [...systemStatuses, { key: 'qa-acceptance', label: 'Acceptance QA', color: 'teal', order: 8, isSystem: false }], createdAt: now, updatedAt: now })
    add(tenantA, 'projectmembers', { _id: id(), project: projectId, user: employeeA, role: 'head', invitationStatus: 'accepted', createdAt: now, updatedAt: now })
    add(tenantA, 'tasks', { _id: taskId, project: projectId, title: 'Synthetic custom status task', status: 'qa-acceptance', createdBy: employeeA, assignedBy: employeeA, order: 0, createdAt: now, updatedAt: now })
    add(tenantA, 'taskassignees', { _id: id(), task: taskId, user: employeeA, assignmentStatus: 'accepted', createdAt: now, updatedAt: now })
    // Midnight IST falls on the previous UTC day: this catches date-boundary loss.
    const attendanceDate = new Date('2026-01-04T18:30:00.000Z')
    add(tenantA, 'attendances', { _id: attendanceId, employee: employeeA, date: attendanceDate, checkIn: new Date('2026-01-05T04:00:00.000Z'), checkOut: new Date('2026-01-05T12:00:00.000Z'), status: 'present', workHours: 8, breakMinutes: 0, source: 'acceptance-only', createdAt: now, updatedAt: now })
    const bytes = Buffer.from('descriptor-only-not-uploaded')
    add(tenantA, 'images.files', { _id: imageId, filename: 'synthetic.png', contentType: 'image/png', length: bytes.length, metadata: { category: 'profile', userId: userA }, storage: { provider: 'vercel-blob', access: 'private', database: tenantA, bucket: 'images', pathname: `tenants/${tenantA}/images/${dataset}/${imageId}-synthetic.png`, length: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } })
    await db.collection('talio_records').insertMany(records)
    await db.collection('talio_catalogs').insertOne({ _id: dataset, status: 'verified-local-dataset', purpose: 'local-acceptance-only', mongoVerified: true, applicationCutover: false, tenants: [{ tenantId: companyA, databaseName: tenantA, active: true }, { tenantId: companyB, databaseName: tenantB, active: true }] })
    const port = await availablePort(), base = `http://127.0.0.1:${port}`
    const childEnv = childEnvironment(env, dataset, port)
    logFd = fs.openSync(logFile, 'a', 0o600)
    child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: root, env: childEnv, detached: true, stdio: ['ignore', logFd, logFd] })
    saveManifest({ status: 'server-starting', port, pid: child.pid, logFile })
    let ready = false
    for (let count = 0; count < 40 && !ready; count++) {
      if (child.exitCode !== null) throw new Error('ISOLATED_SERVER_EXITED')
      try { ready = (await request(base, '/api/health')).ok } catch {}
      if (!ready) await new Promise(resolve => setTimeout(resolve, 500))
    }
    assert.equal(ready, true, 'ISOLATED_SERVER_NOT_READY')
    async function login(email) {
      const response = await request(base, '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
      assert.equal(response.status, 200, 'LOGIN_HTTP_ACCEPTANCE_FAILED')
      const body = await response.json(); assert.equal(body.success, true); assert.ok(body.token)
      return body.token
    }
    let tokenA = await login(emailA)
    const tokenB = await login(emailB); checks.push('real-password-login-and-persisted-session')
    const auth = token => ({ Authorization: `Bearer ${token}` })
    const profile = await request(base, '/api/profile', { headers: auth(tokenA) }); assert.equal(profile.status, 200, 'ACCOUNT_PROFILE_FAILED')
    const profileBody = await profile.json(); assert.equal(profileBody.data.user._id, userA); assert.equal(profileBody.data.employee._id, employeeA); assert.equal(profileBody.data.user.password, undefined)
    const sessions = await request(base, '/api/profile/sessions', { headers: auth(tokenA) }); assert.equal(sessions.status, 200, 'ACCOUNT_SESSIONS_FAILED')
    const sessionsBody = await sessions.json(); assert.equal(sessionsBody.count, 1); assert.equal(sessionsBody.sessions[0].isCurrent, true)
    const session = await request(base, '/api/auth/session', { headers: auth(tokenA) }); assert.equal(session.status, 200); assert.equal((await session.json()).user.id, userA)
    const refresh = await request(base, '/api/auth/session', { method: 'POST', headers: auth(tokenA) }); assert.equal(refresh.status, 200, 'SESSION_REFRESH_FAILED')
    tokenA = (await refresh.json()).data.token; assert.ok(tokenA)
    checks.push('protected-profile-session-list-and-refresh')
    for (const query of [`date=2026-01-05`, 'month=1&year=2026']) {
      const attendance = await request(base, `/api/attendance?employeeId=${employeeA}&${query}`, { headers: auth(tokenA) })
      assert.equal(attendance.status, 200, 'ATTENDANCE_CALENDAR_READ_FAILED')
      // Next development mode adds other private/no-cache directives.
      assert.match(attendance.headers.get('cache-control') || '', /(?:^|,)\s*no-store\s*(?:,|$)/, 'ATTENDANCE_CACHE_HEADER_FAILED')
      const attendanceBody = await attendance.json(); assert.equal(attendanceBody.data.length, 1, 'ATTENDANCE_EXPECTED_ROW_COUNT_FAILED'); assert.equal(attendanceBody.data[0]._id, attendanceId, 'ATTENDANCE_ID_FAILED'); assert.equal(attendanceBody.data[0].date, attendanceDate.toISOString(), 'ATTENDANCE_DATE_FAILED'); assert.equal(attendanceBody.data[0].status, 'present', 'ATTENDANCE_STATUS_FAILED'); assert.equal(attendanceBody.data[0].workHours, 8, 'ATTENDANCE_HOURS_FAILED')
    }
    const previousDay = await request(base, `/api/attendance?employeeId=${employeeA}&date=2026-01-04`, { headers: auth(tokenA) }); assert.equal(previousDay.status, 200); assert.deepEqual((await previousDay.json()).data, [])
    const foreignAttendance = await request(base, `/api/attendance?employeeId=${employeeA}&date=2026-01-05`, { headers: auth(tokenB) }); assert.equal(foreignAttendance.status, 200); assert.deepEqual((await foreignAttendance.json()).data, [])
    assert.equal((await request(base, `/api/attendance?employeeId=${employeeA}&month=13&year=2026`, { headers: auth(tokenA) })).status, 400)
    checks.push('timezone-attendance-day-month-and-tenant-isolation')
    const member = await request(base, `/api/team/members/${employeeA}`, { headers: auth(tokenA) }); assert.equal(member.status, 200, 'MEMBER_DETAIL_FAILED')
    const memberBody = await member.json(); assert.equal(memberBody.data.employee._id, employeeA); assert.equal(memberBody.data.employee.userId, userA); checks.push('member-detail-native-record-link')
    const project = await request(base, `/api/projects/${projectId}`, { headers: auth(tokenA) }); assert.equal(project.status, 200, 'PROJECT_DETAIL_FAILED')
    const projectBody = await project.json(); assert.ok(projectBody.data.taskStatuses.some(status => status.key === 'qa-acceptance' && status.isSystem === false)); checks.push('dynamic-kanban-status-preserved')
    const tasks = await request(base, `/api/projects/${projectId}/tasks?status=qa-acceptance`, { headers: auth(tokenA) }); assert.equal(tasks.status, 200, 'DYNAMIC_TASK_READ_FAILED')
    assert.equal((await tasks.json()).data[0]._id, taskId); checks.push('dynamic-kanban-task-filter')
    const taskEndpoint = `/api/projects/${projectId}/tasks/${taskId}`
    const detail = await request(base, taskEndpoint, { headers: auth(tokenA) }); assert.equal(detail.status, 200, 'TASK_DETAIL_FAILED'); assert.equal((await detail.json()).data.status, 'qa-acceptance')
    for (const status of ['todo', 'qa-acceptance']) {
      const update = await request(base, taskEndpoint, { method: 'PUT', headers: { ...auth(tokenA), 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
      assert.equal(update.status, 200, 'CUSTOM_KANBAN_STATUS_UPDATE_FAILED'); assert.equal((await update.json()).data.status, status)
      const readBack = await request(base, `/api/projects/${projectId}/tasks?status=${status}`, { headers: auth(tokenA) }); assert.equal(readBack.status, 200); assert.equal((await readBack.json()).data[0]._id, taskId)
    }
    const invalidStatus = await request(base, taskEndpoint, { method: 'PUT', headers: { ...auth(tokenA), 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'not-configured' }) }); assert.equal(invalidStatus.status, 400)
    const afterInvalid = await request(base, taskEndpoint, { headers: auth(tokenA) }); assert.equal((await afterInvalid.json()).data.status, 'qa-acceptance')
    assert.equal((await request(base, taskEndpoint, { headers: auth(tokenB) })).status, 404)
    checks.push('dynamic-kanban-native-mutation-validation-and-read-back')
    const media = await request(base, `/api/images/${imageId}`, { headers: { ...auth(tokenA), 'If-None-Match': `"${imageId}-0-0-80"` } }); assert.equal(media.status, 304, 'AUTHORIZED_MEDIA_METADATA_FAILED'); checks.push('media-metadata-auth-before-304-no-blob-fetch')
    for (const [endpoint, expected] of [[`/api/team/members/${employeeA}`, 403], [`/api/projects/${projectId}`, 404], [`/api/images/${imageId}`, 404]]) assert.equal((await request(base, endpoint, { headers: auth(tokenB) })).status, expected, 'FOREIGN_TENANT_DENIAL_FAILED')
    checks.push('foreign-tenant-member-project-media-denied')
    assert.equal((await request(base, `/api/images/${imageId}`, { headers: { 'If-None-Match': `"${imageId}-0-0-80"` } })).status, 401, 'UNAUTHENTICATED_MEDIA_DENIAL_FAILED'); checks.push('unauthenticated-media-denied-before-304')
    assert.equal((await request(base, '/api/profile')).status, 401)
    assert.equal((await request(base, `/api/attendance?employeeId=${employeeA}&date=2026-01-05`)).status, 401)
    const logout = await request(base, '/api/auth/logout', { method: 'POST', headers: auth(tokenA) }); assert.equal(logout.status, 200, 'SESSION_LOGOUT_FAILED')
    assert.equal((await request(base, '/api/profile', { headers: auth(tokenA) })).status, 401, 'REVOKED_SESSION_STILL_AUTHORIZED')
    const revokedSession = await request(base, '/api/auth/session', { headers: auth(tokenA) }); assert.equal((await revokedSession.json()).user, null)
    assert.equal((await request(base, '/api/profile', { headers: auth(tokenB) })).status, 200, 'OTHER_TENANT_SESSION_REVOKED')
    checks.push('native-session-revocation-and-unauthenticated-account-attendance-denial')
    passed = true
  } catch (error) { failure = error }
  finally {
    await stopServer(child); if (logFd !== undefined) fs.closeSync(logFd)
    if (db && ownsNamespace) {
      try {
        const records = await db.collection('talio_records').find({ dataset }).limit(501).toArray(), claims = await db.collection('talio_unique_keys').find({ dataset }).limit(501).toArray(), catalog = await db.collection('talio_catalogs').findOne({ _id: dataset })
        if (records.length > 500 || claims.length > 500) throw new Error('EXACT_HTTP_CLEANUP_BOUND_EXCEEDED')
        const backupFile = path.join(directory, 'temporary-records.pack.json.gz')
        fs.writeFileSync(backupFile, gzipSync(Buffer.from(JSON.stringify(pack({ records, claims, catalog })))), { mode: 0o600 })
        await db.collection('talio_records').deleteMany({ dataset }); await db.collection('talio_unique_keys').deleteMany({ dataset }); await db.collection('talio_catalogs').deleteOne({ _id: dataset })
        assert.equal(await db.collection('talio_records').countDocuments({ dataset }), 0); assert.equal(await db.collection('talio_unique_keys').countDocuments({ dataset }), 0); assert.equal(await db.collection('talio_catalogs').countDocuments({ _id: dataset }), 0)
        saveManifest({ status: passed ? 'passed' : 'failed', cleanup: 'complete', checks, backupFile, logFile, completedAt: new Date().toISOString() })
        console.log(JSON.stringify({ event: passed ? 'http-acceptance-passed' : 'http-acceptance-failed', dataset, checks, backupDirectory: directory, recordsBackedUp: records.length, claimsBackedUp: claims.length, cleanup: 'exact-random-test-dataset-only', blobBytesTested: false }))
      } catch (error) { failure ||= error; console.log(JSON.stringify({ event: 'http-acceptance-cleanup-needs-attention', dataset, backupDirectory: directory })) }
    }
    await client.close()
  }
  if (failure) throw failure
}

if (require.main === module) {
  require('dotenv').config({ path: path.join(root, '.env.local'), quiet: true })
  run(process.env, process.argv.slice(2)).catch(error => { console.error(JSON.stringify({ event: 'http-acceptance-error', name: error.name, code: error.code || 'HTTP_ACCEPTANCE_FAILED', assertion: error.name === 'AssertionError' && /^[A-Z_]+(?:\n|$)/.test(error.message) ? error.message.split('\n')[0] : undefined })); process.exitCode = 1 })
}
module.exports = { childEnvironment, run }
