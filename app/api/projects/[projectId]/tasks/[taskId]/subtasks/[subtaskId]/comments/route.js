import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import mongoose from 'mongoose'
import { createTimelineEvent } from '@/lib/projectService'

// GET - Get all comments for a subtask
export async function GET(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Task', 'TaskAssignee', 'User', 'Employee', 'Project'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models } = auth
    const { Task, TaskAssignee, User, Employee, Project } = models

    const { taskId, subtaskId } = await params

    const task = await Task.findById(taskId).select('subtasks')
    if (!task) {
      return NextResponse.json({ success: false, message: 'Task not found' }, { status: 404 })
    }

    const subtask = task.subtasks.find(st => st._id.toString() === subtaskId)
    if (!subtask) {
      return NextResponse.json({ success: false, message: 'Subtask not found' }, { status: 404 })
    }

    // Populate author details for comments
    const authorIds = (subtask.comments || []).map(c => c.author)
    const authors = await Employee.find({ _id: { $in: authorIds } })
      .select('firstName lastName profilePicture')

    const commentsWithAuthors = (subtask.comments || []).map(comment => {
      const author = authors.find(a => a._id.toString() === comment.author.toString())
      return {
        ...comment.toObject(),
        author: author ? {
          _id: author._id,
          firstName: author.firstName,
          lastName: author.lastName,
          profilePicture: author.profilePicture
        } : { _id: comment.author, firstName: 'Unknown', lastName: 'User' }
      }
    })

    return NextResponse.json({
      success: true,
      data: commentsWithAuthors
    })
  } catch (error) {
    console.error('Get subtask comments error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// POST - Add a comment to a subtask
export async function POST(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Task', 'TaskAssignee', 'User', 'Employee', 'Project'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Task, TaskAssignee, User, Employee, Project } = models

    const { projectId, taskId, subtaskId } = await params
    const body = await request.json()
    const { text } = body

    if (!text || !text.trim()) {
      return NextResponse.json({ success: false, message: 'Comment text is required' }, { status: 400 })
    }

    if (text.length > 500) {
      return NextResponse.json({ success: false, message: 'Comment cannot exceed 500 characters' }, { status: 400 })
    }

    const userDoc = await User.findById(user._id || user.userId).select('employeeId role')
    if (!userDoc || !userDoc.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const task = await Task.findById(taskId).populate('project', 'projectHeads projectHead')
    if (!task) {
      return NextResponse.json({ success: false, message: 'Task not found' }, { status: 404 })
    }

    // Find the subtask index
    const subtaskIndex = task.subtasks.findIndex(st => st._id.toString() === subtaskId)
    if (subtaskIndex === -1) {
      return NextResponse.json({ success: false, message: 'Subtask not found' }, { status: 404 })
    }

    // Check permissions - assignee, creator, assignedBy, project head, or admin can comment
    const isAssignee = await TaskAssignee.findOne({
      task: taskId,
      user: userDoc.employeeId,
      assignmentStatus: 'accepted'
    })
    const isCreator = task.createdBy && task.createdBy.toString() === userDoc.employeeId.toString()
    const isAssigner = task.assignedBy && task.assignedBy.toString() === userDoc.employeeId.toString()
    
    // Safely get project head IDs
    let projectHeadIds = []
    if (task.project && typeof task.project === 'object') {
      if (task.project.projectHeads && task.project.projectHeads.length > 0) {
        projectHeadIds = task.project.projectHeads.map(h => h.toString())
      } else if (task.project.projectHead) {
        projectHeadIds = [task.project.projectHead.toString()]
      }
    }
    const isProjectHead = projectHeadIds.includes(userDoc.employeeId.toString())
    const isAdmin = ['admin'].includes(userDoc.role)

    if (!isAssignee && !isCreator && !isAssigner && !isProjectHead && !isAdmin) {
      return NextResponse.json({ 
        success: false, 
        message: 'You do not have permission to comment on this subtask' 
      }, { status: 403 })
    }

    // Determine author role for color coding
    let authorRole = 'other'
    if (isAdmin) {
      authorRole = 'admin'
    } else if (isProjectHead) {
      authorRole = 'project_head'
    } else if (isAssignee) {
      authorRole = 'assignee'
    } else if (isCreator || isAssigner) {
      authorRole = 'creator'
    }

    // Create the comment
    const newComment = {
      _id: new mongoose.Types.ObjectId(),
      text: text.trim(),
      author: userDoc.employeeId,
      authorRole,
      createdAt: new Date()
    }

    // Add comment to subtask using atomic update
    const updatedTask = await Task.findByIdAndUpdate(
      taskId,
      {
        $push: { [`subtasks.${subtaskIndex}.comments`]: newComment }
      },
      { new: true }
    )

    if (!updatedTask) {
      return NextResponse.json({ success: false, message: 'Failed to add comment' }, { status: 500 })
    }

    // Get author details for response
    const author = await Employee.findById(userDoc.employeeId)
      .select('firstName lastName profilePicture')

    // Create timeline event
    const projectIdForTimeline = task.project?._id || task.project
    const subtaskTitle = task.subtasks[subtaskIndex]?.title || 'Subtask'
    
    if (projectIdForTimeline) {
      createTimelineEvent({
        project: projectIdForTimeline,
        type: 'subtask_comment_added',
        createdBy: userDoc.employeeId,
        relatedTask: taskId,
        description: `${author?.firstName || 'User'} commented on subtask "${subtaskTitle}": "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`,
        metadata: {
          taskTitle: task.title,
          subtaskTitle,
          subtaskId,
          commentText: text,
          authorRole
        }
      }).catch(console.error)
    }

    return NextResponse.json({
      success: true,
      message: 'Comment added successfully',
      data: {
        ...newComment,
        author: {
          _id: author?._id || userDoc.employeeId,
          firstName: author?.firstName || 'Unknown',
          lastName: author?.lastName || 'User',
          profilePicture: author?.profilePicture
        }
      }
    })
  } catch (error) {
    console.error('Add subtask comment error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// DELETE - Delete a comment from a subtask
export async function DELETE(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Task', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Task, User } = models

    const { taskId, subtaskId } = await params
    const { searchParams } = new URL(request.url)
    const commentId = searchParams.get('commentId')

    if (!commentId) {
      return NextResponse.json({ success: false, message: 'Comment ID is required' }, { status: 400 })
    }

    const userDoc = await User.findById(user._id || user.userId).select('employeeId role')
    if (!userDoc || !userDoc.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const task = await Task.findById(taskId).populate('project', 'projectHeads projectHead')
    if (!task) {
      return NextResponse.json({ success: false, message: 'Task not found' }, { status: 404 })
    }

    const subtaskIndex = task.subtasks.findIndex(st => st._id.toString() === subtaskId)
    if (subtaskIndex === -1) {
      return NextResponse.json({ success: false, message: 'Subtask not found' }, { status: 404 })
    }

    const comment = task.subtasks[subtaskIndex].comments?.find(c => c._id.toString() === commentId)
    if (!comment) {
      return NextResponse.json({ success: false, message: 'Comment not found' }, { status: 404 })
    }

    // Check permissions - only comment author, project head, or admin can delete
    const isCommentAuthor = comment.author.toString() === userDoc.employeeId.toString()
    const isAdmin = ['admin'].includes(userDoc.role)
    
    let projectHeadIds = []
    if (task.project && typeof task.project === 'object') {
      if (task.project.projectHeads && task.project.projectHeads.length > 0) {
        projectHeadIds = task.project.projectHeads.map(h => h.toString())
      } else if (task.project.projectHead) {
        projectHeadIds = [task.project.projectHead.toString()]
      }
    }
    const isProjectHead = projectHeadIds.includes(userDoc.employeeId.toString())

    if (!isCommentAuthor && !isAdmin && !isProjectHead) {
      return NextResponse.json({ 
        success: false, 
        message: 'You can only delete your own comments' 
      }, { status: 403 })
    }

    // Remove comment using atomic update
    await Task.findByIdAndUpdate(
      taskId,
      {
        $pull: { [`subtasks.${subtaskIndex}.comments`]: { _id: new mongoose.Types.ObjectId(commentId) } }
      }
    )

    return NextResponse.json({
      success: true,
      message: 'Comment deleted successfully'
    })
  } catch (error) {
    console.error('Delete subtask comment error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
