import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { checkProjectAccess } from '@/lib/projectService'

// GET - Get all notes for a project
export async function GET(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Project', 'ProjectMember', 'ProjectNote', 'Task', 'User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Project, ProjectMember, ProjectNote, Task, User, Employee } = models

    const { projectId } = await params

    const userRecord = await User.findById(user._id || user.userId).select('employeeId role')
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    // Check project access
    const isAdmin = ['admin', 'hr'].includes(userRecord.role || user.role)
    if (!isAdmin) {
      const { hasAccess } = await checkProjectAccess(projectId, userRecord.employeeId, 'view', models)
      if (!hasAccess) {
        return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
      }
    }

    // Get notes - team notes + personal notes of current user
    const notes = await ProjectNote.find({
      project: projectId,
      isArchived: false,
      $or: [
        { visibility: 'team' },
        { visibility: 'personal', createdBy: userRecord.employeeId }
      ]
    })
      .populate('createdBy', 'firstName lastName profilePicture')
      .populate('relatedTask', 'title status')
      .sort({ isPinned: -1, createdAt: -1 })

    return NextResponse.json({
      success: true,
      data: notes
    })
  } catch (error) {
    console.error('Get project notes error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// POST - Create a new note
export async function POST(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Project', 'ProjectMember', 'ProjectNote', 'Task', 'User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Project, ProjectNote, Task, User, Employee } = models

    const { projectId } = await params

    const userRecord = await User.findById(user._id || user.userId).select('employeeId role')
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    // Check if user can participate in project
    const isAdmin = ['admin'].includes(userRecord.role || user.role)
    if (!isAdmin) {
      const { hasAccess } = await checkProjectAccess(projectId, userRecord.employeeId, 'participate', models)
      if (!hasAccess) {
        return NextResponse.json({ 
          success: false, 
          message: 'You must accept the project invitation to add notes' 
        }, { status: 403 })
      }
    }

    const body = await request.json()
    const { title, content, color, visibility, relatedTask, isPinned } = body

    if (!content?.trim()) {
      return NextResponse.json({ success: false, message: 'Note content is required' }, { status: 400 })
    }

    const note = await ProjectNote.create({
      project: projectId,
      createdBy: userRecord.employeeId,
      title: title?.trim(),
      content: content.trim(),
      color: color || 'yellow',
      visibility: visibility || 'team',
      relatedTask,
      isPinned: isPinned || false
    })

    const populatedNote = await ProjectNote.findById(note._id)
      .populate('createdBy', 'firstName lastName profilePicture')
      .populate('relatedTask', 'title status')

    return NextResponse.json({
      success: true,
      message: 'Note created successfully',
      data: populatedNote
    }, { status: 201 })
  } catch (error) {
    console.error('Create project note error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
