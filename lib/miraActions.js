import { resolveMiraPerson } from '@/lib/miraPeople'

export const MIRA_ACTION_PERMISSIONS = {
  create_task: ['tasks', 'create'], create_project: ['projects_create', 'create'],
  create_meeting: ['meetings', 'create'], assign_task: ['tasks', 'assign'], send_message: ['chat', 'create'],
  lookup_people: ['chat', 'view'],
}
const required = {
  create_task: ['title', 'assignees'], create_project: ['name', 'startDate', 'endDate', 'heads'],
  create_meeting: ['title', 'agenda', 'scheduledStart', 'scheduledEnd', 'invitees', 'type'],
  assign_task: ['taskTitle', 'assignees'], send_message: ['recipient', 'content'],
  lookup_people: ['query'],
}
export function validateMiraAction(action) {
  if (!action || !Object.hasOwn(required, action.type) || !action.fields || typeof action.fields !== 'object') return { error: 'Unsupported action. Please use the relevant page.' }
  const fields = {}, allowed = new Set([...required[action.type], 'description', 'priority', 'dueDate', 'location', ...(action.type === 'create_project' ? ['members'] : []), ...(action.type === 'create_task' ? ['project'] : [])])
  for (const [key, value] of Object.entries(action.fields)) {
    if (!allowed.has(key)) continue
    if (['assignees', 'heads', 'invitees', 'members'].includes(key)) {
      if (!Array.isArray(value) || value.length > 20 || value.some(v => typeof v !== 'string' || !v.trim() || v.length > 120)) return { error: `Please provide valid ${key}.` }
      fields[key] = [...new Set(value.map(v => v.trim()))]
    } else if (typeof value === 'string' && value.length <= 3000) fields[key] = value.trim()
  }
  const missing = required[action.type].filter(key => !fields[key]?.length)
  if (action.type === 'create_meeting' && fields.type === 'offline' && !fields.location) missing.push('location')
  if (missing.length) return { error: `Please provide: ${missing.join(', ')}.` }
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

export async function prepareMiraAction(action, user, models) {
  const validation = validateMiraAction(action)
  if (validation.error) throw new Error(validation.error)
  const { type, fields: f } = validation.action
  const own = String(user.employeeId?._id || user.employeeId || '')
  if (!own) throw new Error('An employee profile is required.')
  if (type === 'lookup_people') {
    try { await resolveMiraPerson(f.query, user, models, { type, field: 'query' }) }
    catch (error) { if (error.resolution) return { path: 'lookup', resolution: error.resolution }; throw error }
    return { path: 'lookup', resolution: { candidates: [], more: false } }
  }
  const people = async (names, field) => {
    const ids = []
    for (const name of names) ids.push(await resolveMiraPerson(name, user, models, { field, type }))
    return [...new Set(ids)]
  }
  if (type === 'create_task') {
    const assigneeIds = await people(f.assignees, 'assignees')
    let projectId
    if (f.project) {
      const memberships = await models.ProjectMember.find({ user: own, invitationStatus: 'accepted' }).select('project').lean()
      const scope = ['admin', 'hr'].includes(user.role) ? {} : { $or: [{ createdBy: own }, { projectHead: own }, { projectHeads: own }, { _id: { $in: memberships.map(m => m.project) } }] }
      const projects = await models.Project.find({ $and: [scope, { name: new RegExp(`^${f.project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }] }).select('_id').limit(2).lean()
      if (projects.length !== 1) throw new Error('Please specify a unique project you can access. No task was created.')
      projectId = String(projects[0]._id)
      const members = await models.ProjectMember.find({ project: projectId, user: { $in: assigneeIds } }).select('user').lean()
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
    const scope = user.role === 'admin' ? {} : { $or: [{ createdBy: own }, { assignedBy: own }] }
    const matches = await models.Task.find({ $and: [{ title: f.taskTitle, project: null }, scope] }).select('_id').limit(2).lean()
    if (matches.length !== 1) throw new Error('Please specify a unique standalone task you are allowed to assign. Project task assignments must use the project page.')
    return { path: '/api/tasks/assign-existing', id: String(matches[0]._id), page: 'tasks', body: { assigneeIds: await people(f.assignees, 'assignees') } }
  }
  const [recipient] = await people([f.recipient], 'recipient')
  const chat = await models.Chat.findOne({ participants: { $all: [own, recipient], $size: 2 }, isGroup: false }).select('_id').lean()
  if (!chat) return { path: '/api/chat/start-and-send', recipient, page: 'messages', body: { content: f.content } }
  return { path: '/api/chat/send-existing', id: String(chat._id), page: 'messages', body: { content: f.content } }
}
