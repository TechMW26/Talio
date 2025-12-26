import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'
// GET - Get all pending approval requests for projects where user is project head
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

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Project', 'ProjectApprovalRequest', 'Task', 'User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models } = auth
    const { Project, ProjectApprovalRequest, Task, User, Employee } = models

    const user = await User.findById(decoded.userId).select('employeeId role')
    if (!user || !user.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || 'pending'
    const type = searchParams.get('type')

    // Get all projects where user is project head
    const myProjects = await Project.find({ 
      projectHead: user.employeeId,
      status: { $ne: 'archived' }
    }).select('_id name')

    const projectIds = myProjects.map(p => p._id)

    if (projectIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        message: 'No projects where you are project head'
      })
    }

    // Build query
    const query = { project: { $in: projectIds } }
    if (status !== 'all') {
      query.status = status
    }
    if (type && type !== 'all') {
      query.type = type
    }

    // Get approval requests
    const requests = await ProjectApprovalRequest.find(query)
      .populate('project', 'name status')
      .populate('requestedBy', 'firstName lastName profilePicture employeeCode')
      .populate('reviewedBy', 'firstName lastName')
      .populate('relatedTask', 'title status priority')
      .populate('relatedMember', 'firstName lastName')
      .sort({ createdAt: -1 })

    // Get type stats for current status filter
    const typeStatsQuery = { project: { $in: projectIds } }
    if (status !== 'all') {
      typeStatsQuery.status = status
    }
    
    const typeStatsAgg = await ProjectApprovalRequest.aggregate([
      { $match: typeStatsQuery },
      { $group: { _id: '$type', count: { $sum: 1 } } }
    ])
    
    const typeStats = {}
    typeStatsAgg.forEach(item => {
      typeStats[item._id] = item.count
    })

    return NextResponse.json({
      success: true,
      data: requests,
      stats: {
        pending: await ProjectApprovalRequest.countDocuments({ project: { $in: projectIds }, status: 'pending' }),
        approved: await ProjectApprovalRequest.countDocuments({ project: { $in: projectIds }, status: 'approved' }),
        rejected: await ProjectApprovalRequest.countDocuments({ project: { $in: projectIds }, status: 'rejected' })
      },
      typeStats
    })
  } catch (error) {
    console.error('Get approval requests error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
