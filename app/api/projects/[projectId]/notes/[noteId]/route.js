import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'
// PUT - Update a note
export async function PUT(request, { params }) {
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
    const auth = await getAuthAndModels(request, ['ProjectNote', 'Project', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models } = auth
    const { ProjectNote, Project, User } = models

    const { projectId, noteId } = await params

    const user = await User.findById(decoded.userId).select('employeeId role')
    if (!user || !user.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const note = await ProjectNote.findById(noteId)
    if (!note || note.project.toString() !== projectId) {
      return NextResponse.json({ success: false, message: 'Note not found' }, { status: 404 })
    }

    // Check permissions - only creator, admin, or project head can update
    const project = await Project.findById(projectId)
    const isCreator = note.createdBy.toString() === user.employeeId.toString()
    const isProjectHead = project?.projectHead?.toString() === user.employeeId.toString()
    const isAdmin = ['admin'].includes(user.role)

    if (!isCreator && !isProjectHead && !isAdmin) {
      return NextResponse.json({ 
        success: false, 
        message: 'You can only edit your own notes' 
      }, { status: 403 })
    }

    const body = await request.json()
    const { title, content, color, visibility, isPinned, position } = body

    const updates = {}
    if (title !== undefined) updates.title = title?.trim()
    if (content !== undefined) updates.content = content?.trim()
    if (color) updates.color = color
    if (visibility) updates.visibility = visibility
    if (isPinned !== undefined) updates.isPinned = isPinned
    if (position) updates.position = position

    await ProjectNote.findByIdAndUpdate(noteId, updates)

    const updatedNote = await ProjectNote.findById(noteId)
      .populate('createdBy', 'firstName lastName profilePicture')
      .populate('relatedTask', 'title status')

    return NextResponse.json({
      success: true,
      message: 'Note updated successfully',
      data: updatedNote
    })
  } catch (error) {
    console.error('Update project note error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// DELETE - Archive a note
export async function DELETE(request, { params }) {
  try {
    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    const { projectId, noteId } = await params

    const user = await User.findById(decoded.userId).select('employeeId role')
    if (!user || !user.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const note = await ProjectNote.findById(noteId)
    if (!note || note.project.toString() !== projectId) {
      return NextResponse.json({ success: false, message: 'Note not found' }, { status: 404 })
    }

    // Check permissions
    const project = await Project.findById(projectId)
    const isCreator = note.createdBy.toString() === user.employeeId.toString()
    const isProjectHead = project?.projectHead?.toString() === user.employeeId.toString()
    const isAdmin = ['admin'].includes(user.role)

    if (!isCreator && !isProjectHead && !isAdmin) {
      return NextResponse.json({ 
        success: false, 
        message: 'You can only delete your own notes' 
      }, { status: 403 })
    }

    // Soft delete
    await ProjectNote.findByIdAndUpdate(noteId, { isArchived: true })

    return NextResponse.json({
      success: true,
      message: 'Note deleted successfully'
    })
  } catch (error) {
    console.error('Delete project note error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
