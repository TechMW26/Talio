import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { PROJECT_STORE_OPTIONS, projectFilter as f, projectRows } from '@/lib/projects.server'
import { checkProjectAccess, createTimelineEvent } from '@/lib/projectService'
import {
  DEFAULT_TASK_STATUSES,
  SYSTEM_STATUS_KEYS,
  STATUS_COLOR_KEYS,
  getProjectTaskStatuses,
  slugifyStatusKey
} from '@/lib/taskStatusConfig'

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  try {
    const auth = await getAuthAndDatabase(request, PROJECT_STORE_OPTIONS)
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, database } = auth
    const { projectId } = await params

    const userRecord = await database.get('users', String(user._id || user.userId))
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const project = await database.get('projects', projectId)
    if (!project) {
      return NextResponse.json({ success: false, message: 'Project not found' }, { status: 404 })
    }

    const isAdmin = ['admin', 'hr'].includes(userRecord.role || user.role)
    if (!isAdmin) {
      const { hasAccess } = await checkProjectAccess(projectId, userRecord.employeeId, 'view', database)
      if (!hasAccess) {
        return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
      }
    }

    return NextResponse.json({
      success: true,
      data: getProjectTaskStatuses(project)
    })
  } catch (error) {
    console.error('Get project statuses error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

export async function PUT(request, { params }) {
  try {
    const auth = await getAuthAndDatabase(request, PROJECT_STORE_OPTIONS)
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, database } = auth
    const { projectId } = await params

    const userRecord = await database.get('users', String(user._id || user.userId))
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const project = await database.get('projects', projectId)
    if (!project) {
      return NextResponse.json({ success: false, message: 'Project not found' }, { status: 404 })
    }

    const isAdmin = ['admin', 'hr'].includes(userRecord.role || user.role)
    if (!isAdmin) {
      const { hasAccess } = await checkProjectAccess(projectId, userRecord.employeeId, 'manage', database)
      if (!hasAccess) {
        return NextResponse.json({
          success: false,
          message: 'Only the project head or an admin can manage task statuses'
        }, { status: 403 })
      }
    }

    const body = await request.json()
    const incoming = Array.isArray(body?.statuses) ? body.statuses : null
    if (!incoming || incoming.length > 50 || incoming.some(status => !status || typeof status !== 'object')) {
      return NextResponse.json({ success: false, message: 'A "statuses" array is required' }, { status: 400 })
    }

    const currentStatuses = getProjectTaskStatuses(project)

    for (const systemKey of SYSTEM_STATUS_KEYS) {
      const match = incoming.find(s => s.key === systemKey)
      if (!match) {
        return NextResponse.json({
          success: false,
          message: `"${systemKey}" is a built-in status and cannot be removed`
        }, { status: 400 })
      }
    }

    const seenKeys = new Set()
    const finalStatuses = []
    for (let i = 0; i < incoming.length; i++) {
      const raw = incoming[i]
      const isSystem = SYSTEM_STATUS_KEYS.includes(raw.key)
      const label = String(raw.label || '').trim()
      if (!label) {
        return NextResponse.json({ success: false, message: 'Every status needs a label' }, { status: 400 })
      }
      if (label.length > 60) {
        return NextResponse.json({ success: false, message: 'Status labels must be 60 characters or fewer' }, { status: 400 })
      }

      let key = raw.key
      if (!isSystem) {
        if (!key || seenKeys.has(key) || !/^[a-z0-9-]+$/.test(key)) {
          key = slugifyStatusKey(label, [...seenKeys, ...SYSTEM_STATUS_KEYS])
        }
      }
      if (seenKeys.has(key)) {
        return NextResponse.json({ success: false, message: `Duplicate status key "${key}"` }, { status: 400 })
      }
      seenKeys.add(key)

      const color = STATUS_COLOR_KEYS.includes(raw.color) ? raw.color : 'gray'

      finalStatuses.push({ key, label, color, order: i, isSystem })
    }

    const removedKeys = currentStatuses
      .filter(s => !s.isSystem)
      .map(s => s.key)
      .filter(key => !finalStatuses.some(s => s.key === key))

    if (removedKeys.length > 0) {
      const tasksUsingRemoved = (await projectRows(database, 'tasks', [f('project', projectId)])).filter(task => removedKeys.includes(task.status)).length
      if (tasksUsingRemoved > 0) {
        return NextResponse.json({
          success: false,
          message: `Move the ${tasksUsingRemoved} task(s) still using a removed status to a different status first`
        }, { status: 400 })
      }
    }

    await database.mutate('projects', projectId, current => ({ ...current, taskStatuses: finalStatuses, updatedAt: new Date() }))

    createTimelineEvent({
      project: projectId,
      type: 'project_updated',
      createdBy: userRecord.employeeId,
      description: 'Task statuses were updated',
      metadata: { taskStatuses: finalStatuses }
    }, database).catch(console.error)

    return NextResponse.json({
      success: true,
      message: 'Task statuses updated successfully',
      data: finalStatuses
    })
  } catch (error) {
    console.error('Update project statuses error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
