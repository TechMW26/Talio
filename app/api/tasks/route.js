import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import Project from '@/models/Project'
import ProjectMember from '@/models/ProjectMember'
import User from '@/models/User'

export const dynamic = 'force-dynamic'

/**
 * GET /api/tasks
 * 
 * Legacy tasks endpoint - now returns project tasks
 * This is a compatibility layer for older code that still calls /api/tasks
 */
export async function GET(request) {
  try {
    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    await connectDB()

    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get('employee')
    const limit = parseInt(searchParams.get('limit')) || 50
    const view = searchParams.get('view')
    const dueDate = searchParams.get('dueDate')

    const user = await User.findById(decoded.userId).select('employeeId role')
    if (!user) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 })
    }

    const empId = employeeId || user.employeeId?.toString()

    // Get projects where user is a member or owner
    const memberProjectIds = await ProjectMember.find({
      employee: empId,
      invitationStatus: 'accepted'
    }).distinct('project')

    const query = {
      $or: [
        { _id: { $in: memberProjectIds } },
        { createdBy: decoded.userId }
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

    return NextResponse.json({
      success: true,
      data: tasks,
      total: tasks.length
    })

  } catch (error) {
    console.error('Error in /api/tasks:', error)
    return NextResponse.json({ 
      success: false, 
      message: error.message || 'Failed to fetch tasks',
      data: []
    }, { status: 500 })
  }
}
