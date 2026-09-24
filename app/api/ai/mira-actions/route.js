import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/permissions'
import { MIRA_ACTION_PERMISSIONS, prepareMiraAction, validateMiraAction } from '@/lib/miraActions'

export async function POST(request) {
  try {
    const input = await request.json()
    const validation = validateMiraAction(input.action)
    if (validation.error) return NextResponse.json({ success: false, message: validation.error }, { status: 400 })
    const [page, permission] = MIRA_ACTION_PERMISSIONS[validation.action.type]
    const auth = await requirePermission(page, permission)(request, ['Employee', 'Department', 'Task', 'TaskAssignee', 'Meeting', 'Chat', 'Project', 'ProjectMember'])
    if (auth.denied) return NextResponse.json({ success: false, message: 'Your current access level does not permit this action. Ask an administrator for the required permission.' }, { status: auth.denied.status })
    if (validation.action.type === 'create_task' && validation.action.fields.assignees.some(name => !/^(me|myself|self)$/i.test(name))) {
      const assignment = await requirePermission('tasks', 'assign')(request)
      if (assignment.denied) return NextResponse.json({ success: false, message: 'Higher clearance is required to assign tasks to other people.' }, { status: 403 })
    }
    const prepared = await prepareMiraAction(validation.action, auth.user, auth.models)
    if (prepared.path === 'navigate') return NextResponse.json({ success: true, message: `Opening ${prepared.name}.`, navigation: { page: prepared.page, id: prepared.id } })
    if (prepared.path === 'lookup') {
      const people = prepared.resolution.candidates
      return NextResponse.json({ success: true, resolution: { ...prepared.resolution, resolved: true }, message: people.length
        ? `${prepared.resolution.more ? 'Showing the first' : 'Found'} ${people.length} matching contacts:\n${people.map(p => `- ${p.name}${p.code ? ` (${p.code})` : ''}${p.department ? `, ${p.department}` : ''}`).join('\n')}`
        : 'No matching contacts found. Try another spelling or employee code.' })
    }
    if (input.confirmed !== true) return NextResponse.json({ success: true, preview: validation.action })
    // Fixed in-process delegates: no arbitrary URLs, headers, IDs or database queries from the model.
    const headers = new Headers({ 'Content-Type': 'application/json' })
    for (const key of ['authorization', 'cookie']) if (request.headers.get(key)) headers.set(key, request.headers.get(key))
    const delegated = new Request(new URL(prepared.path, request.url), { method: 'POST', headers, body: JSON.stringify(prepared.body), signal: request.signal })
    let result
    if (prepared.path === '/api/chat/start-and-send') {
      const created = await (await import('@/app/api/chat/route')).POST(new Request(new URL('/api/chat', request.url), { method: 'POST', headers, body: JSON.stringify({ isGroup: false, participants: [prepared.recipient] }), signal: request.signal }))
      const chat = await created.json()
      if (!created.ok || !chat.success || !chat.data?._id) return NextResponse.json({ success: false, message: 'Could not open the private conversation. No message was sent.' }, { status: 400 })
      result = await (await import('@/app/api/chat/[chatId]/messages/route')).POST(delegated, { params: Promise.resolve({ chatId: String(chat.data._id) }) })
    }
    else if (prepared.path === '/api/tasks/create') result = await (await import('@/app/api/tasks/create/route')).POST(delegated)
    else if (prepared.path === '/api/projects') result = await (await import('@/app/api/projects/route')).POST(delegated)
    else if (prepared.path === '/api/meetings') result = await (await import('@/app/api/meetings/route')).POST(delegated)
    else if (prepared.path === '/api/tasks/assign-existing') result = await (await import('@/app/api/tasks/[taskId]/assign/route')).POST(delegated, { params: Promise.resolve({ taskId: prepared.id }) })
    else result = await (await import('@/app/api/chat/[chatId]/messages/route')).POST(delegated, { params: Promise.resolve({ chatId: prepared.id }) })
    const data = await result.json()
    if (!result.ok || data.success === false) return NextResponse.json({ success: false, message: result.status === 403 ? 'Higher clearance is required for this action.' : data.message || 'The action could not be completed.' }, { status: result.status })
    const createdId = String(data.data?._id || data.project?._id || data.task?._id || '')
    const resource = /^[a-f\d]{24}$/i.test(createdId) && ['create_project', 'create_meeting'].includes(validation.action.type)
      ? { page: prepared.page, id: createdId } : undefined
    return NextResponse.json({ success: true, message: data.message || 'Completed successfully.', page: prepared.page, ...(resource ? { resource } : {}) })
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof SyntaxError ? 'Invalid action request.' : error.message || 'Action failed. Check the page before retrying.', ...(error.resolution ? { resolution: error.resolution } : {}) }, { status: error.resolution ? 409 : 400 })
  }
}
