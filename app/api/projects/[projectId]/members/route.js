import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { checkProjectAccess, createTimelineEvent } from '@/lib/projectService'
import {
  notifyProjectInvitation,
  notifyMemberAdded,
  notifyMemberRemoved,
  getProjectMemberUserIds
} from '@/lib/projectNotifications'
import { createProjectInvitationNotification } from '@/lib/actionableNotifications'
import { emitEvent, EVENTS } from '@/lib/eventBus'

// GET - Get project members
export async function GET(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Project', 'ProjectMember', 'User', 'Employee', 'Chat', 'ProjectTimelineEvent'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Project, ProjectMember, User, Employee, Chat } = models

    const { projectId } = await params

    const userRecord = await User.findById(user._id || user.userId).select('employeeId')
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const members = await ProjectMember.find({ project: projectId })
      .populate({
        path: 'user',
        select: 'firstName lastName profilePicture email employeeCode department',
        populate: { path: 'department', select: 'name' }
      })
      .populate('invitedBy', 'firstName lastName')
      .populate('sourceDepartment', 'name')
      .sort({ role: 1, createdAt: 1 })

    return NextResponse.json({
      success: true,
      data: members,
      currentEmployeeId: userRecord.employeeId.toString()
    })
  } catch (error) {
    console.error('Get members error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// POST - Add/Invite member to project
export async function POST(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Project', 'ProjectMember', 'User', 'Employee', 'Chat', 'ProjectTimelineEvent', 'ActionableNotification'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Project, ProjectMember, User, Employee, Chat } = models

    const { projectId } = await params

    const userRecord = await User.findById(user._id || user.userId).select('employeeId role')
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const project = await Project.findById(projectId)
    if (!project) {
      return NextResponse.json({ success: false, message: 'Project not found' }, { status: 404 })
    }

    // Check if user can invite members
    const isAdmin = ['admin'].includes(userRecord.role || user.role)
    const isHead = project.projectHead.toString() === userRecord.employeeId.toString()
    const isCreator = project.createdBy.toString() === userRecord.employeeId.toString()

    // Check member permissions
    const currentMembership = await ProjectMember.findOne({
      project: projectId,
      user: userRecord.employeeId,
      invitationStatus: 'accepted'
    })

    const canInvite = isAdmin || isHead || isCreator || currentMembership?.permissions?.canInviteMembers

    if (!canInvite) {
      return NextResponse.json({
        success: false,
        message: 'You do not have permission to invite members'
      }, { status: 403 })
    }

    const body = await request.json()
    const { userId, memberIds, role = 'member', isExternal = false, sourceDepartment } = body

    // Support both single userId and array of memberIds
    const userIdsToAdd = memberIds && Array.isArray(memberIds) ? memberIds : (userId ? [userId] : [])

    if (userIdsToAdd.length === 0) {
      return NextResponse.json({ success: false, message: 'User ID is required' }, { status: 400 })
    }

    const addedMembers = []
    const errors = []

    for (const userIdToAdd of userIdsToAdd) {
      try {
        // Check if already a member
        const existingMember = await ProjectMember.findOne({
          project: projectId,
          user: userIdToAdd
        })

        if (existingMember) {
          errors.push({ userId: userIdToAdd, message: 'User is already a member' })
          continue
        }

        // Verify the user exists
        const invitedEmployee = await Employee.findById(userIdToAdd)
        if (!invitedEmployee) {
          errors.push({ userId: userIdToAdd, message: 'User not found' })
          continue
        }

        // Create membership
        const membership = await ProjectMember.create({
          project: projectId,
          user: userIdToAdd,
          role,
          invitationStatus: 'invited',
          invitedBy: userRecord.employeeId,
          isExternal,
          sourceDepartment: isExternal ? sourceDepartment : invitedEmployee.department
        })

        // Add to chat group
        if (project.chatGroup) {
          await Chat.findByIdAndUpdate(project.chatGroup, {
            $addToSet: { participants: userIdToAdd }
          })
        }

        // Create timeline event
        const inviterEmployee = await Employee.findById(userRecord.employeeId)
        await createTimelineEvent({
          project: projectId,
          type: 'member_invited',
          createdBy: userRecord.employeeId,
          relatedMember: userIdToAdd,
          description: `${invitedEmployee.firstName} ${invitedEmployee.lastName} was invited to the project`,
          metadata: { role, isExternal }
        }, models)

        // Send notification - pass models for multi-tenant support
        await notifyProjectInvitation(project, invitedEmployee, inviterEmployee, models, 'member')

        // Create actionable notification for the invited user (persistent toast)
        try {
          // Get the invited user's User ID (not employee ID)
          const invitedUser = await User.findOne({ employeeId: userIdToAdd }).select('_id')
          if (invitedUser) {
            await createProjectInvitationNotification(models, {
              targetUserId: invitedUser._id,
              projectId: projectId,
              projectName: project.name,
              invitedBy: userRecord.employeeId,
              invitedByName: inviterEmployee ? `${inviterEmployee.firstName} ${inviterEmployee.lastName}` : 'Someone'
            })
          }
        } catch (actionErr) {
          console.error('[ProjectMembers] Error creating actionable notification:', actionErr)
          // Don't fail the request if actionable notification fails
        }

        const populatedMembership = await ProjectMember.findById(membership._id)
          .populate('user', 'firstName lastName profilePicture email employeeCode department')
          .populate('invitedBy', 'firstName lastName')

        addedMembers.push(populatedMembership)
      } catch (err) {
        console.error(`Error adding member ${userIdToAdd}:`, err)
        errors.push({ userId: userIdToAdd, message: err.message })
      }
    }

    if (addedMembers.length === 0 && errors.length > 0) {
      return NextResponse.json({
        success: false,
        message: errors[0]?.message || 'Failed to add members',
        errors
      }, { status: 400 })
    }

    // Emit sidebar counts update via eventBus for invited members
    try {
      const invitedUserIds = []
      for (const member of addedMembers) {
        const memberUser = await User.findOne({ employeeId: member.user?._id || member.user }).select('_id')
        if (memberUser) invitedUserIds.push(memberUser._id.toString())
      }
      if (invitedUserIds.length > 0) {
        emitEvent(EVENTS.PROJECT_INVITATION_CHANGED, {
          projectId,
          projectName: project.name,
          action: 'invited',
          memberCount: addedMembers.length,
        }, {
          userIds: invitedUserIds,
          databaseName: auth.tenant?.databaseName,
        })
      }
    } catch (eventBusError) {
      console.error('Failed to emit eventBus project invitation event:', eventBusError)
    }

    return NextResponse.json({
      success: true,
      message: addedMembers.length === 1 ? 'Member invited successfully' : `${addedMembers.length} members invited successfully`,
      data: addedMembers.length === 1 ? addedMembers[0] : addedMembers,
      errors: errors.length > 0 ? errors : undefined
    }, { status: 201 })
  } catch (error) {
    console.error('Add member error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// DELETE - Remove member from project
export async function DELETE(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Project', 'ProjectMember', 'User', 'Employee', 'Chat', 'ProjectTimelineEvent'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Project, ProjectMember, User, Employee, Chat } = models

    const { projectId } = await params
    const { searchParams } = new URL(request.url)
    const memberId = searchParams.get('memberId')

    if (!memberId) {
      return NextResponse.json({ success: false, message: 'Member ID is required' }, { status: 400 })
    }

    const userRecord = await User.findById(user._id || user.userId).select('employeeId role')
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const project = await Project.findById(projectId)
    if (!project) {
      return NextResponse.json({ success: false, message: 'Project not found' }, { status: 404 })
    }

    const membership = await ProjectMember.findById(memberId).populate('user')
    if (!membership || membership.project.toString() !== projectId) {
      return NextResponse.json({ success: false, message: 'Member not found' }, { status: 404 })
    }

    // Cannot remove the project head
    if (membership.role === 'head') {
      return NextResponse.json({
        success: false,
        message: 'Cannot remove the project head'
      }, { status: 400 })
    }

    // Check permission to remove
    const isAdmin = ['admin'].includes(userRecord.role || user.role)
    const isHead = project.projectHead.toString() === userRecord.employeeId.toString()
    const isSelf = membership.user._id.toString() === userRecord.employeeId.toString()

    if (!isAdmin && !isHead && !isSelf) {
      return NextResponse.json({
        success: false,
        message: 'You do not have permission to remove this member'
      }, { status: 403 })
    }

    // Remove from chat group
    if (project.chatGroup) {
      await Chat.findByIdAndUpdate(project.chatGroup, {
        $pull: { participants: membership.user._id }
      })
    }

    // Create timeline event
    await createTimelineEvent({
      project: projectId,
      type: 'member_removed',
      createdBy: userRecord.employeeId,
      relatedMember: membership.user._id,
      description: `${membership.user.firstName} ${membership.user.lastName} was removed from the project`,
      metadata: { removedBy: isSelf ? 'self' : 'admin' }
    }, models)

    // Send notification if not self-removal
    if (!isSelf) {
      const removerEmployee = await Employee.findById(userRecord.employeeId)
      await notifyMemberRemoved(project, membership.user, removerEmployee, models)
    }

    await ProjectMember.findByIdAndDelete(memberId)

    return NextResponse.json({
      success: true,
      message: 'Member removed successfully'
    })
  } catch (error) {
    console.error('Remove member error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
