import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
export const dynamic = 'force-dynamic'

/**
 * GET /api/tasks/dashboard
 * 
 * Legacy tasks dashboard endpoint - now returns project stats
 */
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Project', 'ProjectMember', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Project, ProjectMember } = models

    const { searchParams } = new URL(request.url)
    const view = searchParams.get('view') || 'all'
    const timeframe = searchParams.get('timeframe') || 'all'

    if (!user) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 })
    }

    const empId = user.employeeId?._id?.toString() || user.employeeId?.toString()

    // Get projects where user is a member
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

    const projects = await Project.find(query).lean()

    // Calculate stats
    const stats = {
      total: projects.length,
      completed: projects.filter(p => p.status === 'completed').length,
      inProgress: projects.filter(p => p.status === 'in-progress').length,
      pending: projects.filter(p => p.status === 'pending' || p.status === 'planning').length,
      onHold: projects.filter(p => p.status === 'on-hold').length,
      overdue: projects.filter(p => p.endDate && new Date(p.endDate) < new Date() && p.status !== 'completed').length
    }

    return NextResponse.json({
      success: true,
      data: {
        stats,
        tasks: projects.slice(0, 10).map(p => ({
          _id: p._id,
          title: p.name,
          status: p.status,
          priority: p.priority || 'medium',
          dueDate: p.endDate
        }))
      }
    })

  } catch (error) {
    console.error('Error in /api/tasks/dashboard:', error)
    return NextResponse.json({ 
      success: false, 
      message: error.message || 'Failed to fetch dashboard',
      data: { stats: { total: 0, completed: 0, inProgress: 0, pending: 0, onHold: 0, overdue: 0 }, tasks: [] }
    }, { status: 500 })
  }
}
