/**
 * Project Service
 * Core business logic for project management including
 * completion percentage calculation, status transitions, and member management
 */

import Project from '@/models/Project'
import ProjectMember from '@/models/ProjectMember'
import Task from '@/models/Task'
import TaskAssignee from '@/models/TaskAssignee'
import ProjectTimelineEvent from '@/models/ProjectTimelineEvent'
import ProjectCompletionApproval from '@/models/ProjectCompletionApproval'
import Chat from '@/models/Chat'
import Employee from '@/models/Employee'
import User from '@/models/User'

/**
 * Calculate and update project completion percentage
 * Uses a weighted approach: task progress based on subtasks contributes to overall project progress
 * - If a task has subtasks: its contribution = (completed subtasks / total subtasks)
 * - If a task has no subtasks: it contributes 0 if not completed, 1 if completed
 * @param {string} projectId - The project ID
 * @returns {number} - The calculated completion percentage
 */
export async function calculateCompletionPercentage(projectId) {
  const tasks = await Task.find({
    project: projectId,
    status: { $ne: 'archived' }
  }).select('status subtasks progressPercentage')
  
  if (tasks.length === 0) {
    await Project.findByIdAndUpdate(projectId, { completionPercentage: 0 })
    return 0
  }
  
  // Calculate weighted progress for each task
  let totalProgress = 0
  
  for (const task of tasks) {
    if (task.status === 'completed') {
      // Completed tasks contribute 100%
      totalProgress += 100
    } else if (task.subtasks && task.subtasks.length > 0) {
      // Tasks with subtasks: contribute based on subtask completion
      const completedSubtasks = task.subtasks.filter(st => st.completed).length
      const taskProgress = (completedSubtasks / task.subtasks.length) * 100
      totalProgress += taskProgress
    }
    // Tasks with no subtasks and not completed contribute 0
  }
  
  const percentage = Math.round(totalProgress / tasks.length)
  
  await Project.findByIdAndUpdate(projectId, { completionPercentage: percentage })
  
  return percentage
}

/**
 * Get task statistics for a project
 */
export async function getProjectTaskStats(projectId) {
  const tasks = await Task.find({
    project: projectId,
    status: { $ne: 'archived' }
  }).select('status dueDate')
  
  const now = new Date()
  
  return {
    total: tasks.length,
    completed: tasks.filter(t => t.status === 'completed').length,
    inProgress: tasks.filter(t => t.status === 'in-progress').length,
    todo: tasks.filter(t => t.status === 'todo').length,
    review: tasks.filter(t => t.status === 'review').length,
    blocked: tasks.filter(t => t.status === 'blocked').length,
    rejected: tasks.filter(t => t.status === 'rejected').length,
    overdue: tasks.filter(t => 
      t.dueDate && new Date(t.dueDate) < now && 
      !['completed', 'archived'].includes(t.status)
    ).length
  }
}

/**
 * Create a timeline event for a project
 */
export async function createTimelineEvent(data) {
  const event = await ProjectTimelineEvent.create(data)
  return event
}

/**
 * Create a project with all initial setup (members, chat group, timeline event)
 */
export async function createProject(projectData, creatorEmployee, initialMembers = []) {
  // Create the project
  const project = await Project.create({
    ...projectData,
    createdBy: creatorEmployee._id,
    status: projectData.status || 'planned'
  })
  
  // Create project head as member with 'head' role (auto-accepted)
  await ProjectMember.create({
    project: project._id,
    user: projectData.projectHead,
    role: 'head',
    invitationStatus: 'accepted',
    invitedBy: creatorEmployee._id,
    respondedAt: new Date()
  })
  
  // Create creator as member if different from head (auto-accepted)
  if (creatorEmployee._id.toString() !== projectData.projectHead.toString()) {
    await ProjectMember.create({
      project: project._id,
      user: creatorEmployee._id,
      role: 'member',
      invitationStatus: 'accepted',
      invitedBy: creatorEmployee._id,
      respondedAt: new Date()
    })
  }
  
  // Create invited members
  for (const member of initialMembers) {
    if (member.userId.toString() !== projectData.projectHead.toString() &&
        member.userId.toString() !== creatorEmployee._id.toString()) {
      await ProjectMember.create({
        project: project._id,
        user: member.userId,
        role: member.role || 'member',
        invitationStatus: 'invited',
        invitedBy: creatorEmployee._id,
        isExternal: member.isExternal || false,
        sourceDepartment: member.sourceDepartment
      })
    }
  }
  
  // Create chat group for the project
  const allMemberIds = [
    projectData.projectHead,
    creatorEmployee._id,
    ...initialMembers.map(m => m.userId)
  ]
  const uniqueMemberIds = [...new Set(allMemberIds.map(id => id.toString()))].map(id => id)
  
  const chatGroup = await Chat.create({
    name: project.name,
    isGroup: true,
    participants: uniqueMemberIds,
    admin: creatorEmployee._id,
    createdBy: creatorEmployee._id,
    messages: []
  })
  
  // Update project with chat group reference
  project.chatGroup = chatGroup._id
  await project.save()
  
  // Create timeline event
  await createTimelineEvent({
    project: project._id,
    type: 'project_created',
    createdBy: creatorEmployee._id,
    description: `Project "${project.name}" was created`,
    metadata: {
      projectName: project.name,
      startDate: project.startDate,
      endDate: project.endDate,
      initialMemberCount: uniqueMemberIds.length
    }
  })
  
  // Create member_invited events for each invited member
  for (const member of initialMembers) {
    await createTimelineEvent({
      project: project._id,
      type: 'member_invited',
      createdBy: creatorEmployee._id,
      relatedMember: member.userId,
      description: `Member was invited to the project`,
      metadata: {
        role: member.role || 'member',
        isExternal: member.isExternal || false
      }
    })
  }
  
  return project
}

/**
 * Handle member invitation response (accept/reject)
 */
export async function respondToInvitation(projectId, employeeId, accept, rejectionReason = null) {
  const membership = await ProjectMember.findOne({
    project: projectId,
    user: employeeId
  })
  
  if (!membership) {
    throw new Error('Membership not found')
  }
  
  if (membership.invitationStatus !== 'invited') {
    throw new Error('Invitation already responded to')
  }
  
  const project = await Project.findById(projectId)
  if (!project) {
    throw new Error('Project not found')
  }
  
  membership.invitationStatus = accept ? 'accepted' : 'rejected'
  membership.respondedAt = new Date()
  if (!accept && rejectionReason) {
    membership.rejectionReason = rejectionReason
  }
  await membership.save()
  
  // If accepted, add to chat group
  if (accept && project.chatGroup) {
    await Chat.findByIdAndUpdate(project.chatGroup, {
      $addToSet: { participants: employeeId }
    })
  }
  
  // Create timeline event
  await createTimelineEvent({
    project: projectId,
    type: accept ? 'member_accepted' : 'member_rejected',
    createdBy: employeeId,
    relatedMember: employeeId,
    description: accept 
      ? 'Member accepted the project invitation'
      : `Member rejected the project invitation${rejectionReason ? `: ${rejectionReason}` : ''}`,
    metadata: {
      rejectionReason
    }
  })
  
  return membership
}

/**
 * Request project completion approval
 */
export async function requestCompletionApproval(projectId, requesterEmployee, remark = '') {
  const project = await Project.findById(projectId)
  if (!project) {
    throw new Error('Project not found')
  }
  
  // Check if there's already a pending approval
  const existingApproval = await ProjectCompletionApproval.findOne({
    project: projectId,
    status: 'pending'
  })
  
  if (existingApproval) {
    throw new Error('There is already a pending completion approval request')
  }
  
  // Get task stats for snapshot
  const stats = await getProjectTaskStats(projectId)
  
  // Create approval request
  const approval = await ProjectCompletionApproval.create({
    project: projectId,
    requestedBy: requesterEmployee._id,
    projectHead: project.projectHead,
    requestRemark: remark,
    completionSnapshot: {
      totalTasks: stats.total,
      completedTasks: stats.completed,
      completionPercentage: project.completionPercentage,
      pendingTasks: stats.total - stats.completed
    }
  })
  
  // Update project status
  project.status = 'completed_pending_approval'
  await project.save()
  
  // Create timeline event
  await createTimelineEvent({
    project: projectId,
    type: 'project_completion_requested',
    createdBy: requesterEmployee._id,
    description: `Project completion approval requested${remark ? `: ${remark}` : ''}`,
    metadata: {
      remark,
      completionSnapshot: approval.completionSnapshot
    }
  })
  
  return approval
}

/**
 * Respond to completion approval (approve/reject)
 */
export async function respondToCompletionApproval(approvalId, responderEmployee, approve, remark = '', unmarkSubtasks = false) {
  const approval = await ProjectCompletionApproval.findById(approvalId)
    .populate('project')
  
  if (!approval) {
    throw new Error('Approval request not found')
  }
  
  if (approval.status !== 'pending') {
    throw new Error('This approval has already been processed')
  }
  
  // Check if responder is the project head
  if (approval.projectHead.toString() !== responderEmployee._id.toString()) {
    throw new Error('Only the project head can respond to completion approvals')
  }
  
  approval.status = approve ? 'approved' : 'rejected'
  approval.responseRemark = remark
  approval.respondedBy = responderEmployee._id
  approval.respondedAt = new Date()
  await approval.save()
  
  // Update project status
  const project = await Project.findById(approval.project._id)
  if (approve) {
    project.status = 'completed'
  } else {
    project.status = 'ongoing' // Reset to ongoing if rejected
    
    // If unmarkSubtasks is true, mark all tasks and subtasks as incomplete
    if (unmarkSubtasks) {
      // Find all tasks for this project
      const tasks = await Task.find({ project: project._id })
      
      for (const task of tasks) {
        let updated = false
        
        // Mark task as in-progress if it was completed
        if (task.status === 'completed' || task.status === 'review') {
          task.status = 'in-progress'
          updated = true
        }
        
        // Mark all subtasks as incomplete
        if (task.subtasks && task.subtasks.length > 0) {
          task.subtasks.forEach(subtask => {
            if (subtask.completed) {
              subtask.completed = false
              updated = true
            }
          })
        }
        
        if (updated) {
          await task.save()
          
          // Create timeline event for task update
          await createTimelineEvent({
            project: project._id,
            type: 'task_updated',
            createdBy: responderEmployee._id,
            relatedTask: task._id,
            description: `Task "${task.title}" and subtasks reset due to project rejection`,
            metadata: {
              reason: 'Project Rejection',
              action: 'reset_status'
            }
          })
        }
      }
    }
  }
  await project.save()
  
  // Create timeline event
  await createTimelineEvent({
    project: project._id,
    type: approve ? 'project_approved' : 'project_rejected',
    createdBy: responderEmployee._id,
    description: approve 
      ? `Project marked as completed${remark ? `: ${remark}` : ''}`
      : `Project completion rejected${remark ? `: ${remark}` : ''}`,
    metadata: {
      remark,
      previousStatus: 'completed_pending_approval',
      unmarkSubtasks
    }
  })
  
  return { approval, project }
}

/**
 * Check if user can access/manage project
 */
export async function checkProjectAccess(projectId, employeeId, requiredAccess = 'view') {
  const membership = await ProjectMember.findOne({
    project: projectId,
    user: employeeId
  })
  
  if (!membership) {
    return { hasAccess: false, membership: null }
  }
  
  if (requiredAccess === 'view') {
    // Invited users can view basic info
    return { hasAccess: true, membership }
  }
  
  if (requiredAccess === 'participate') {
    // Only accepted members can participate
    return {
      hasAccess: membership.invitationStatus === 'accepted',
      membership
    }
  }
  
  if (requiredAccess === 'manage') {
    // Only head can manage
    return {
      hasAccess: membership.role === 'head' && membership.invitationStatus === 'accepted',
      membership
    }
  }
  
  return { hasAccess: false, membership }
}

/**
 * Get user's projects with filters
 */
export async function getUserProjects(employeeId, filters = {}) {
  const { status, role, invitationStatus } = filters
  
  const memberQuery = { user: employeeId }
  
  if (invitationStatus) {
    memberQuery.invitationStatus = invitationStatus
  }
  if (role) {
    memberQuery.role = role
  }
  
  const memberships = await ProjectMember.find(memberQuery)
    .select('project role invitationStatus')
  
  const projectIds = memberships.map(m => m.project)
  
  const projectQuery = { _id: { $in: projectIds } }
  
  if (status) {
    if (Array.isArray(status)) {
      projectQuery.status = { $in: status }
    } else {
      projectQuery.status = status
    }
  }
  
  // Exclude archived unless specifically requested
  if (!status || (Array.isArray(status) && !status.includes('archived'))) {
    projectQuery.status = projectQuery.status || { $ne: 'archived' }
  }
  
  const projects = await Project.find(projectQuery)
    .populate('projectHead', 'firstName lastName profilePicture')
    .populate('createdBy', 'firstName lastName')
    .populate('department', 'name')
    .sort({ updatedAt: -1 })
  
  // Attach membership info to each project
  return projects.map(project => {
    const membership = memberships.find(m => m.project.toString() === project._id.toString())
    return {
      ...project.toObject(),
      userRole: membership?.role,
      userInvitationStatus: membership?.invitationStatus
    }
  })
}

/**
 * Get today's tasks for a user
 */
export async function getTodaysTasks(employeeId) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  
  // Get tasks assigned to user
  const assignments = await TaskAssignee.find({
    user: employeeId,
    assignmentStatus: { $in: ['pending', 'accepted'] }
  }).select('task')
  
  const taskIds = assignments.map(a => a.task)
  
  const tasks = await Task.find({
    _id: { $in: taskIds },
    status: { $nin: ['completed', 'archived'] },
    $or: [
      { dueDate: { $gte: today, $lt: tomorrow } },
      { dueDate: { $lt: today } } // Also get overdue tasks
    ]
  })
    .populate('project', 'name status')
    .sort({ dueDate: 1, priority: -1 })
  
  return tasks
}

/**
 * Update project status with validation
 */
export async function updateProjectStatus(projectId, newStatus, updaterEmployee, metadata = {}) {
  const project = await Project.findById(projectId)
  if (!project) {
    throw new Error('Project not found')
  }
  
  const oldStatus = project.status
  
  // Validate status transition
  const validTransitions = {
    'planned': ['ongoing', 'archived'],
    'ongoing': ['completed_pending_approval', 'pending', 'archived'],
    'pending': ['ongoing', 'archived'],
    'completed_pending_approval': ['completed', 'ongoing'], // Only via approval flow
    'completed': ['archived'],
    'approved': ['archived'],
    'rejected': ['ongoing', 'archived'],
    'overdue': ['ongoing', 'completed_pending_approval', 'archived'],
    'archived': [] // Cannot change from archived
  }
  
  if (!validTransitions[oldStatus]?.includes(newStatus)) {
    throw new Error(`Invalid status transition from ${oldStatus} to ${newStatus}`)
  }
  
  project.status = newStatus
  await project.save()
  
  await createTimelineEvent({
    project: projectId,
    type: 'project_status_changed',
    createdBy: updaterEmployee._id,
    description: `Project status changed from ${oldStatus} to ${newStatus}`,
    metadata: {
      oldStatus,
      newStatus,
      ...metadata
    }
  })
  
  return project
}

/**
 * Check and mark overdue projects
 * This can be run via a cron job
 */
export async function checkOverdueProjects() {
  const now = new Date()
  
  const overdueProjects = await Project.find({
    endDate: { $lt: now },
    status: { $in: ['planned', 'ongoing', 'pending'] }
  })
  
  for (const project of overdueProjects) {
    project.status = 'overdue'
    await project.save()
    
    await createTimelineEvent({
      project: project._id,
      type: 'project_status_changed',
      createdBy: project.projectHead, // System action attributed to head
      description: 'Project marked as overdue',
      metadata: {
        oldStatus: project.status,
        newStatus: 'overdue',
        reason: 'Deadline exceeded'
      }
    })
  }
  
  return overdueProjects.length
}

/**
 * Check and mark overdue tasks
 * This can be run via a cron job
 */
export async function checkOverdueTasks() {
  const now = new Date()
  
  const overdueTasks = await Task.find({
    dueDate: { $lt: now },
    status: { $nin: ['completed', 'archived', 'blocked'] }
  }).populate('project')
  
  return overdueTasks
}

/**
 * Get project summary for MAYA
 */
export async function getProjectSummaryForMaya(projectId) {
  const project = await Project.findById(projectId)
    .populate('projectHead', 'firstName lastName')
    .populate('createdBy', 'firstName lastName')
    .populate('department', 'name')
  
  if (!project) return null
  
  const members = await ProjectMember.find({ project: projectId })
    .populate('user', 'firstName lastName')
  
  const taskStats = await getProjectTaskStats(projectId)
  
  const recentEvents = await ProjectTimelineEvent.find({ project: projectId })
    .populate('createdBy', 'firstName lastName')
    .sort({ createdAt: -1 })
    .limit(10)
  
  return {
    id: project._id.toString(),
    name: project.name,
    description: project.description,
    status: project.status,
    startDate: project.startDate,
    endDate: project.endDate,
    completionPercentage: project.completionPercentage,
    priority: project.priority,
    projectHead: project.projectHead 
      ? `${project.projectHead.firstName} ${project.projectHead.lastName}` 
      : 'N/A',
    department: project.department?.name || 'N/A',
    members: members.map(m => ({
      name: `${m.user.firstName} ${m.user.lastName}`,
      role: m.role,
      status: m.invitationStatus
    })),
    taskStats,
    isOverdue: project.isOverdue,
    daysRemaining: project.daysRemaining,
    recentActivity: recentEvents.map(e => ({
      type: e.type,
      description: e.description,
      by: e.createdBy ? `${e.createdBy.firstName} ${e.createdBy.lastName}` : 'System',
      at: e.createdAt
    }))
  }
}

/**
 * Get user's project summary for MAYA
 */
export async function getUserProjectsSummaryForMaya(employeeId) {
  const projects = await getUserProjects(employeeId, { invitationStatus: 'accepted' })
  
  const summaries = []
  
  for (const project of projects) {
    const taskStats = await getProjectTaskStats(project._id)
    
    // Get user's tasks in this project
    const userAssignments = await TaskAssignee.find({
      user: employeeId,
      assignmentStatus: 'accepted'
    }).select('task')
    
    const userTaskIds = userAssignments.map(a => a.task.toString())
    
    const userTasks = await Task.find({
      _id: { $in: userTaskIds },
      project: project._id
    }).select('title status dueDate priority')
    
    summaries.push({
      projectId: project._id.toString(),
      projectName: project.name,
      status: project.status,
      userRole: project.userRole,
      completionPercentage: project.completionPercentage,
      deadline: project.endDate,
      isOverdue: new Date() > project.endDate && 
        !['completed', 'approved', 'archived'].includes(project.status),
      projectStats: taskStats,
      userTasks: userTasks.map(t => ({
        id: t._id.toString(),
        title: t.title,
        status: t.status,
        dueDate: t.dueDate,
        priority: t.priority,
        isOverdue: t.dueDate && new Date() > t.dueDate && t.status !== 'completed'
      }))
    })
  }
  
  return {
    totalProjects: summaries.length,
    activeProjects: summaries.filter(p => 
      ['planned', 'ongoing', 'pending'].includes(p.status)
    ).length,
    overdueProjects: summaries.filter(p => p.isOverdue).length,
    projects: summaries
  }
}
