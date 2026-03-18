import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { buildCacheKey, getCache, setCache } from '@/lib/cache'
export const dynamic = 'force-dynamic'

/**
 * GET /api/tasks
 * 
 * Legacy tasks endpoint - now returns project tasks
 * This is a compatibility layer for older code that still calls /api/tasks
 */
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Project', 'ProjectMember', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models, tenant } = auth
    const { Project, ProjectMember } = models

    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get('employee')
    const limit = parseInt(searchParams.get('limit')) || 50
    const view = searchParams.get('view')
    const dueDate = searchParams.get('dueDate')

    // Check Redis cache (60s TTL - project list changes infrequently)
    const cacheKey = buildCacheKey({
      tenantId: tenant?.databaseName,
      role: user.role || 'employee',
      userId: user._id || user.userId,
      namespace: 'tasks:personal',
      params: { employeeId, limit, view, dueDate },
    })
    const cachedResult = await getCache(cacheKey)
    if (cachedResult) {
      return NextResponse.json(cachedResult)
    }

    if (!user) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 })
    }

    const empId = employeeId || user.employeeId?._id?.toString() || user.employeeId?.toString()

    // Get projects where user is a member or owner
    const memberProjectIds = await ProjectMember.find({
      employee: empId,
      invitationStatus: 'accepted'
    }).distinct('project')

    const query = {
      $or: [
        { _id: { $in: memberProjectIds } },
        { createdBy: user._id || user.userId }
      ],
      status: { $ne: 'deleted' }
    }

    const projects = await Project.find(query)
      .populate('createdBy', 'firstName lastName email')
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean()

    // Transform projects to task-like format for compatibility
    const tasks = projects.map(project => ({
      _id: project._id,
      title: project.name,
      description: project.description,
      status: project.status === 'completed' ? 'completed' :
        project.status === 'in-progress' ? 'in_progress' :
          project.status === 'on-hold' ? 'on_hold' : 'pending',
      priority: project.priority || 'medium',
      progress: project.progress || 0,
      dueDate: project.endDate,
      startDate: project.startDate,
      completedAt: project.completedAt,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      assignee: project.createdBy,
      project: {
        _id: project._id,
        name: project.name
      }
    }))

    const resultData = { success: true, data: tasks, total: tasks.length }
    await setCache(cacheKey, resultData, 60).catch(() => { })

    return NextResponse.json(resultData)

  } catch (error) {
    console.error('Error in /api/tasks:', error)
    return NextResponse.json({
      success: false,
      message: error.message || 'Failed to fetch tasks',
      data: []
    }, { status: 500 })
  }
}
