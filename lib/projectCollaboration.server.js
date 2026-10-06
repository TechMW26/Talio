import { after, NextResponse } from 'next/server'
import { getAuthAndDatabase } from './auth'
import { PROJECT_STORE_OPTIONS, projectId as id, projectFailure as fail, projectRows, projectRecords, projectFilter as f, projectMembership, employeeSummary, newProjectRecordId } from './projects.server'
import { checkProjectAccess, respondToInvitation } from './projectService'
import { notifyProjectInvitationAccepted, notifyProjectInvitationRejected, notifyCommentAdded, getProjectMemberUserIds } from './projectNotifications'
import { getActionableDatabase } from './actionableNotificationStore.server'
import { dismissNotificationsForReference } from './actionableNotifications'
import { emitEvent, EVENTS } from './eventBus'

export async function projectContext(request, projectId, access) {
  const auth = await getAuthAndDatabase(request, PROJECT_STORE_OPTIONS)
  if (!auth.success) fail(auth.message, 401)
  const employeeId = id(auth.user.employeeId)
  if (!employeeId) fail('Employee not found', 404)
  const project = await auth.database.get('projects', projectId)
  if (!project || project.deletedAt) fail('Project not found', 404)
  const admin = access === 'view' ? ['admin', 'hr'].includes(auth.user.role) : auth.user.role === 'admin'
  if (access && !admin && !(await checkProjectAccess(projectId, employeeId, access, auth.database)).hasAccess) fail('Access denied', 403)
  return { auth, database: auth.database, employeeId, project }
}
export const projectHandler = handler => async (request, route) => { try { return await handler(request, await route.params) } catch (error) { return NextResponse.json({ success: false, message: error.message }, { status: error.status || 500 }) } }
const context = projectContext, safe = projectHandler
async function relatedTask(database, taskId, projectId) {
  if (!taskId) return null
  const task = await database.get('tasks', id(taskId))
  if (!task || id(task.project) !== projectId) fail('Related task not found in this project', 404)
  return task
}
async function populateNote(database, note) {
  const [creator, task] = await Promise.all([database.get('employees', id(note.createdBy)), note.relatedTask ? database.get('tasks', id(note.relatedTask)) : null])
  return { ...note, createdBy: employeeSummary(creator), relatedTask: task ? { _id: task._id, title: task.title, status: task.status } : null }
}
function noteInput(input, existing = {}) {
  const result = { title: '', content: '', color: 'yellow', visibility: 'team', isPinned: false, position: { x: 0, y: 0 }, ...existing }
  for (const key of ['title', 'content']) if (input[key] !== undefined) { if (typeof input[key] !== 'string') fail(`Invalid note ${key}`); result[key] = input[key].trim() }
  if (!result.content || result.content.length > 2000 || result.title.length > 100) fail('Note content is required (up to 2000 characters); title must be under 100 characters')
  for (const [key, values] of [['color', ['yellow', 'blue', 'green', 'pink', 'purple', 'orange']], ['visibility', ['personal', 'team']]]) {
    if (input[key] !== undefined) { if (!values.includes(input[key])) fail(`Invalid note ${key}`); result[key] = input[key] }
  }
  if (input.isPinned !== undefined) { if (typeof input.isPinned !== 'boolean') fail('Invalid pinned flag'); result.isPinned = input.isPinned }
  if (input.position !== undefined) { if (!Number.isFinite(input.position?.x) || !Number.isFinite(input.position?.y)) fail('Invalid note position'); result.position = { x: input.position.x, y: input.position.y } }
  return result
}
export const listProjectNotes = safe(async (request, { projectId }) => {
  const { database, employeeId } = await context(request, projectId, 'view')
  const notes = (await projectRows(database, 'projectnotes', [f('project', projectId)])).filter(note => !note.isArchived && (note.visibility === 'team' || (note.visibility === 'personal' && id(note.createdBy) === employeeId)))
  notes.sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || +new Date(b.createdAt) - +new Date(a.createdAt))
  return NextResponse.json({ success: true, data: await Promise.all(notes.map(note => populateNote(database, note))) })
})
export const createProjectNote = safe(async (request, { projectId }) => {
  const { database, employeeId, auth } = await context(request, projectId, 'participate'), input = await request.json(), values = noteInput(input)
  const task = await relatedTask(database, input.relatedTask, projectId), now = new Date()
  const note = { ...values, _id: newProjectRecordId(), project: projectId, createdBy: employeeId, relatedTask: task?._id || null, isArchived: false, createdAt: now, updatedAt: now }
  const membership = await projectMembership(database, projectId, employeeId)
  await database.transaction(async tx => {
    const currentProject = await tx.get('projects', projectId)
    const member = membership ? await tx.get('projectmembers', membership._id) : null
    if (!currentProject || (auth.user.role !== 'admin' && member?.invitationStatus !== 'accepted')) fail('Project access changed', 403)
    await tx.create('projectnotes', note)
  })
  return NextResponse.json({ success: true, message: 'Note created successfully', data: await populateNote(database, note) }, { status: 201 })
})
export function changeProjectNote(archive = false) { return safe(async (request, { projectId, noteId }) => {
  const { database, employeeId, auth } = await context(request, projectId, null), input = archive ? {} : await request.json()
  const note = await database.transaction(async tx => {
    const current = await tx.get('projectnotes', noteId), project = await tx.get('projects', projectId)
    if (!current || id(current.project) !== projectId || !project) fail('Note not found', 404)
    const owner = id(current.createdBy) === employeeId
    const head = [project.projectHead, ...(project.projectHeads || [])].filter(Boolean).map(id).includes(employeeId)
    if (!owner && (!head && auth.user.role !== 'admin' || current.visibility === 'personal')) fail('You can only edit your own personal notes', 403)
    const next = { ...(archive ? current : noteInput(input, current)), ...(archive ? { isArchived: true } : {}), updatedAt: new Date() }
    await tx.replace('projectnotes', next)
    return next
  })
  return NextResponse.json({ success: true, message: archive ? 'Note deleted successfully' : 'Note updated successfully', ...(!archive ? { data: await populateNote(database, note) } : {}) })
}) }
export const respondToProjectInvitation = safe(async (request, { projectId }) => {
  const { database, employeeId, auth, project } = await context(request, projectId, null), { action, reason = '' } = await request.json()
  if (!['accept', 'reject'].includes(action) || typeof reason !== 'string' || reason.length > 2000) fail('Valid accept/reject action and optional reason are required')
  const employee = await database.get('employees', employeeId)
  if (!employee) fail('Employee not found', 404)
  const membership = await respondToInvitation(projectId, employeeId, action === 'accept', reason, database)
  after(async () => {
    try {
      // Dismiss only this recipient's invitation, not every member's pending action.
      await dismissNotificationsForReference(await getActionableDatabase(auth), 'Project', projectId, { recipientId: id(auth.user._id || auth.user.userId) })
      await emitEvent(EVENTS.PROJECT_INVITATION_CHANGED, { projectId, action: action === 'accept' ? 'accepted' : 'rejected' }, { userIds: [id(auth.user._id || auth.user.userId)], databaseName: database.databaseName })
      const notifyEmployees = [...new Set([project.createdBy, project.projectHead, ...(project.projectHeads || [])].filter(Boolean).map(id))].filter(value => value !== employeeId)
      const users = []
      for (const recipient of notifyEmployees) users.push(...await projectRows(database, 'users', [f('employeeId', recipient)]))
      if (action === 'accept') await notifyProjectInvitationAccepted(project, employee, users.map(user => user._id), database)
      else await notifyProjectInvitationRejected(project, employee, users.map(user => user._id), reason, database)
    } catch (error) { console.error('Invitation follow-up failed:', error.message) }
  })
  return NextResponse.json({ success: true, message: action === 'accept' ? 'Project invitation accepted' : 'Project invitation declined', data: membership })
})

export const listProjectTimeline = safe(async (request, { projectId }) => {
  const { database } = await context(request, projectId, 'view'), query = new URL(request.url).searchParams
  const limit = Math.min(100, Math.max(1, Number(query.get('limit')) || 50)), offset = Math.max(0, Number(query.get('offset')) || 0)
  if (!Number.isInteger(offset) || offset > 10000) fail('Invalid offset; use cursor pagination')
  const filters = [f('project', projectId)]; if (query.get('type')) filters.push(f('type', query.get('type')))
  let cursor = query.get('cursor') || null, skipped = 0, page
  do {
    const size = skipped < offset ? Math.min(100, offset - skipped) : limit
    page = await database.list('projecttimelineevents', { filters, orderBy: [{ field: 'createdAt', direction: 'desc' }], limit: size, cursor })
    if (skipped >= offset) break
    skipped += page.records.length; cursor = page.nextCursor
    if (!cursor) { page = { records: [], nextCursor: null }; break }
  } while (true)
  const people = new Map((await projectRecords(database, 'employees', page.records.flatMap(event => [event.createdBy, event.relatedMember]))).map(person => [id(person), employeeSummary(person)]))
  const tasks = new Map((await projectRecords(database, 'tasks', page.records.map(event => event.relatedTask))).map(task => [id(task), { _id: task._id, title: task.title, status: task.status }]))
  const total = await database.count('projecttimelineevents', filters)
  return NextResponse.json({ success: true, data: page.records.map(event => ({ ...event, createdBy: people.get(id(event.createdBy)) || null, relatedMember: people.get(id(event.relatedMember)) || null, relatedTask: tasks.get(id(event.relatedTask)) || null })), pagination: { total, offset, limit, hasMore: Boolean(page.nextCursor), nextCursor: page.nextCursor } })
})
export const addProjectComment = safe(async (request, { projectId }) => {
  const { database, employeeId, auth, project } = await context(request, projectId, 'participate'), input = await request.json()
  if (typeof input.content !== 'string' || !input.content.trim() || input.content.length > 5000) fail('Comment is required and must be under 5000 characters')
  const task = await relatedTask(database, input.taskId, projectId), employee = await database.get('employees', employeeId)
  const membership = await projectMembership(database, projectId, employeeId), now = new Date()
  const event = { _id: newProjectRecordId(), project: projectId, type: 'comment_added', createdBy: employeeId, relatedTask: task?._id || null, description: `${employee?.firstName || ''} ${employee?.lastName || ''} added a comment`, commentContent: input.content.trim(), metadata: { taskId: task?._id || null, commentPreview: input.content.slice(0, 100) }, isInternal: false, createdAt: now, updatedAt: now }
  const notify = await database.transaction(async tx => {
    const recent = await tx.list('projecttimelineevents', { filters: [f('project', projectId), f('type', 'comment_added'), f('createdBy', employeeId)], orderBy: [{ field: 'createdAt', direction: 'desc' }], limit: 1 })
    const member = membership ? await tx.get('projectmembers', membership._id) : null
    if (auth.user.role !== 'admin' && member?.invitationStatus !== 'accepted') fail('Project access changed', 403)
    await tx.create('projecttimelineevents', event)
    return !recent.records[0] || +now - +new Date(recent.records[0].createdAt) > 300000
  })
  if (notify) after(async () => { try { await notifyCommentAdded(project, employee, await getProjectMemberUserIds(projectId, employeeId, database), input.content, database) } catch (error) { console.error('Comment notification failed:', error.message) } })
  return NextResponse.json({ success: true, message: 'Comment added successfully', data: { ...event, createdBy: employeeSummary(employee), relatedTask: task ? { _id: task._id, title: task.title } : null } }, { status: 201 })
})
