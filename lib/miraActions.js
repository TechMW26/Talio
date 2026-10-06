import { resolveMiraPerson } from '@/lib/miraPeople'
import { getMiraResourceStore, getVisibleProjects, getVisibleTasks, getVisibleMeetings } from '@/lib/platform/firestoreMiraResources.server'
import { listScreenshotMaintenanceRecords } from '@/lib/platform/firestoreScreenshots.server'

export const MIRA_ACTION_PERMISSIONS = {
  view_productivity: ['productivity', 'view'],
  create_task: ['tasks', 'create'], create_project: ['projects_create', 'create'],
  create_meeting: ['meetings', 'create'], assign_task: ['tasks', 'assign'], send_message: ['chat', 'create'],
  lookup_people: ['chat', 'view'],
  open_project: ['projects', 'view'],
  open_task: ['tasks', 'view'], open_meeting: ['meetings', 'view'],
  invite_project: ['projects', 'view'], invite_meeting: ['meetings', 'view'],
}
const required = {
  schedule_reminder: ['message', 'scheduledFor', 'timezone'],
  view_productivity: ['employee', 'date'],
  create_task: ['title', 'assignees'], create_project: ['name', 'startDate', 'endDate', 'heads'],
  create_meeting: ['title', 'agenda', 'scheduledStart', 'scheduledEnd', 'invitees', 'type'],
  assign_task: ['taskTitle', 'assignees'], send_message: ['recipient', 'content'],
  lookup_people: ['query'],
  open_project: ['query'],
  open_task: ['query'], open_meeting: ['query'],
  invite_project: ['query', 'invitees'], invite_meeting: ['query', 'invitees'],
}
export function validateMiraAction(action) {
  if (!action || !Object.hasOwn(required, action.type) || !action.fields || typeof action.fields !== 'object') return { error: 'Unsupported action. Please use the relevant page.' }
  const fields = {}, allowed = new Set([...required[action.type], 'description', 'priority', 'dueDate', 'location', ...(action.type === 'view_productivity' ? ['at', 'offset'] : []), ...(action.type === 'create_project' ? ['members'] : []), ...(action.type === 'create_task' ? ['project'] : [])])
  for (const [key, value] of Object.entries(action.fields)) {
    if (!allowed.has(key)) continue
    if (['assignees', 'heads', 'invitees', 'members'].includes(key)) {
      if (!Array.isArray(value) || value.length > 20 || value.some(v => typeof v !== 'string' || !v.trim() || v.length > 120)) return { error: `Please provide valid ${key}.` }
      fields[key] = [...new Set(value.map(v => v.trim()))]
    } else if (typeof value === 'string' && value.length <= 3000) fields[key] = value.trim()
  }
  // Resolve "me" from the authenticated employee during preparation; never
  // trust a model-supplied creator ID or borrow an owner from another task.
  const ownerField = { create_task: 'assignees', create_project: 'heads' }[action.type]
  if (ownerField && !fields[ownerField]?.length) fields[ownerField] = ['me']
  const missing = required[action.type].filter(key => !fields[key]?.length)
  if (action.type === 'create_meeting' && fields.type === 'offline' && !fields.location) missing.push('location')
  if (missing.length) return { error: `Please provide: ${missing.join(', ')}.` }
  if (action.type === 'schedule_reminder') {
    if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(fields.scheduledFor) || !Number.isFinite(Date.parse(fields.scheduledFor)) || Date.parse(fields.scheduledFor) <= Date.now()) return { error: 'Please choose a future reminder time including its timezone.' }
    try { new Intl.DateTimeFormat('en', { timeZone: fields.timezone }).format() } catch { return { error: 'Please provide a valid timezone for your reminder.' } }
    if (fields.message.length > 500) return { error: 'Please keep the reminder under 500 characters.' }
  }
  if (fields.priority && !['low', 'medium', 'high', 'urgent'].includes(fields.priority)) return { error: 'Choose low, medium, high or urgent priority.' }
  if (fields.type && !['online', 'offline'].includes(fields.type)) return { error: 'Choose an online or offline meeting.' }
  for (const key of ['startDate', 'endDate', 'dueDate', 'scheduledStart', 'scheduledEnd']) {
    if (fields[key] && (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(fields[key]) || !Number.isFinite(Date.parse(fields[key])))) return { error: `Please provide a valid ${key}.` }
  }
  if (fields.scheduledStart && (!/(Z|[+-]\d{2}:\d{2})$/.test(fields.scheduledStart) || !/(Z|[+-]\d{2}:\d{2})$/.test(fields.scheduledEnd))) return { error: 'Please include the timezone for the meeting times.' }
  if ((fields.endDate && Date.parse(fields.endDate) < Date.parse(fields.startDate)) ||
      (fields.scheduledEnd && Date.parse(fields.scheduledEnd) <= Date.parse(fields.scheduledStart))) return { error: 'The end must be after the start.' }
  return { action: { type: action.type, fields } }
}

export async function prepareMiraAction(action, user, context) {
  const validation = validateMiraAction(action)
  if (validation.error) throw new Error(validation.error)
  const { type, fields: f } = validation.action
  const store = await getMiraResourceStore(context?.databaseName)
  const own = String(user.employeeId?._id || user.employeeId || '')
  if (!own) throw new Error('An employee profile is required.')
  if (type === 'invite_project' || type === 'invite_meeting') {
    const target = await prepareMiraAction({ type: type === 'invite_project' ? 'open_project' : 'open_meeting', fields: { query: f.query } }, user, context)
    const ids = []
    for (const name of f.invitees) ids.push(await resolveMiraPerson(name, user, context, { field: 'invitees', type }))
    return type === 'invite_project'
      ? { path: '/api/projects/invite-existing', id: target.id, body: { memberIds: [...new Set(ids)] } }
      : { path: '/api/meetings/invite-existing', id: target.id, method: 'PUT', body: { addInvitees: [...new Set(ids)] } }
  }
  if (type === 'open_task' || type === 'open_meeting') {
    const kind = type === 'open_task' ? 'task' : 'meeting'
    const id = f.query.match(new RegExp(`^${kind}:([a-f\\d]{24})$`, 'i'))?.[1]
    let matches = await (kind === 'task' ? getVisibleTasks : getVisibleMeetings)(store, user, { id, search: f.query });
    const exact = matches.filter(value => String(value.title || '').toLowerCase() === f.query.toLowerCase());
    if (exact.length) matches = exact;
    matches = matches.sort((a, b) => String(a.title).localeCompare(String(b.title))).slice(0, 6);
    if (!matches.length) throw new Error(`No matching ${kind} is available within your access.`)
    if (matches.length > 1) {
      const error = new Error(`Which ${kind} should I open?`)
      error.resolution = { kind, field: 'query', query: f.query, more: matches.length > 5, candidates: matches.slice(0, 5).map(item => ({ name: item.title, value: `${kind}:${item._id}` })) }
      throw error
    }
    return { path: 'navigate', page: kind === 'task' ? 'tasks' : 'meetings', id: String(matches[0]._id), name: matches[0].title }
  }
  if (type === 'open_project') {
    const id = f.query.match(/^project:([a-f\d]{24})$/i)?.[1];
    let projects = await getVisibleProjects(store, user, { id, search: f.query });
    const exact = projects.filter(value => String(value.name || '').toLowerCase() === f.query.toLowerCase());
    if (exact.length) projects = exact;
    projects = projects.sort((a, b) => String(a.name).localeCompare(String(b.name))).slice(0, 6);
    if (!projects.length) throw new Error('No matching project is available within your access. Check the name or ask an administrator for access.')
    if (projects.length > 1) {
      const error = new Error('Which project should I open?')
      error.resolution = { kind: 'project', field: 'query', query: f.query, more: projects.length > 5, candidates: projects.slice(0, 5).map(p => ({ name: p.name, value: `project:${p._id}` })) }
      throw error
    }
    return { path: 'navigate', page: 'projects', id: String(projects[0]._id), name: projects[0].name }
  }
  if (type === 'lookup_people') {
    try { await resolveMiraPerson(f.query, user, context, { type, field: 'query' }) }
    catch (error) { if (error.resolution) return { path: 'lookup', resolution: error.resolution }; throw error }
    return { path: 'lookup', resolution: { candidates: [], more: false } }
  }
  const people = async (names, field) => {
    const ids = []
    for (const name of names) ids.push(await resolveMiraPerson(name, user, context, { field, type }))
    return [...new Set(ids)]
  }
  if (type === 'create_task') {
    const assigneeIds = await people(f.assignees, 'assignees')
    let projectId
    if (f.project) {
      const projects = (await getVisibleProjects(store, user, { search: f.project, taskCreation: true })).filter(value => String(value.name || '').toLowerCase() === f.project.toLowerCase());
      if (projects.length !== 1) throw new Error('Please specify a unique project you can access. No task was created.')
      projectId = String(projects[0]._id)
      const members = await listScreenshotMaintenanceRecords(store, 'projectmembers', [{ field: 'project', operator: '==', value: projectId }, { field: 'user', operator: 'in', value: assigneeIds }], 1000)
      const allowedIds = new Set([own, ...members.map(m => String(m.user))])
      if (assigneeIds.some(id => !allowedIds.has(id))) throw new Error('One or more assignees are not members of that project. Add them to the project first. No task was created.')
    }
    return { path: '/api/tasks/create', page: 'tasks', body: {
      title: f.title, description: f.description, priority: f.priority, dueDate: f.dueDate, assigneeIds, ...(projectId ? { projectId } : {}),
    } }
  }
  if (type === 'create_project') return { path: '/api/projects', page: 'projects', body: {
    name: f.name, description: f.description, startDate: f.startDate, endDate: f.endDate, projectHeadIds: await people(f.heads, 'heads'),
    members: (await people(f.members || [], 'members')).map(userId => ({ userId, role: 'member' })),
  } }
  if (type === 'create_meeting') return { path: '/api/meetings', page: 'meetings', body: {
    title: f.title, agenda: [{ title: f.agenda }], scheduledStart: f.scheduledStart, scheduledEnd: f.scheduledEnd,
    type: f.type, location: f.location, inviteeIds: await people(f.invitees, 'invitees'),
  } }
  if (type === 'assign_task') {
    const matches = (await getVisibleTasks(store, user, { search: f.taskTitle, assignOnly: true })).filter(value => !value.project && value.title === f.taskTitle);
    if (matches.length !== 1) throw new Error('Please specify a unique standalone task you are allowed to assign. Project task assignments must use the project page.')
    return { path: '/api/tasks/assign-existing', id: String(matches[0]._id), page: 'tasks', body: { assigneeIds: await people(f.assignees, 'assignees') } }
  }
  const [recipient] = await people([f.recipient], 'recipient')
  const chat = (await listScreenshotMaintenanceRecords(store, 'chats', [{ field: 'participants', operator: 'array-contains', value: own }, { field: 'isGroup', operator: '==', value: false }], 10000)).find(value => value.participants?.length === 2 && value.participants.map(String).includes(recipient))
  if (!chat) return { path: '/api/chat/start-and-send', recipient, page: 'messages', body: { content: f.content } }
  return { path: '/api/chat/send-existing', id: String(chat._id), page: 'messages', body: { content: f.content } }
}
