/**
 * Project Management Notification Types and Handlers
 * Centralized event emission and push notification handling for projects
 * 
 * MULTI-TENANT: This module now supports tenant-aware models.
 * Pass tenant models via options.models when called from authenticated routes.
 * Falls back to default models for backward compatibility (cron jobs, etc.)
 */

import { sendPushToUser, sendPushToUsers } from '@/lib/pushNotification'
import DefaultUser from '@/models/User'
import DefaultEmployee from '@/models/Employee'
import connectDB from '@/lib/mongodb'

// Notification type constants
export const PROJECT_NOTIFICATION_TYPES = {
  // Project-level
  PROJECT_INVITATION: 'project_invitation',
  PROJECT_INVITATION_ACCEPTED: 'project_invitation_accepted',
  PROJECT_INVITATION_REJECTED: 'project_invitation_rejected',
  PROJECT_COMPLETION_REQUESTED: 'project_completion_requested',
  PROJECT_APPROVED: 'project_approved',
  PROJECT_REJECTED: 'project_rejected',
  PROJECT_MEMBER_ADDED: 'project_member_added',
  PROJECT_MEMBER_REMOVED: 'project_member_removed',
  PROJECT_UPDATED: 'project_updated',
  
  // Task-level
  TASK_ASSIGNED: 'task_assigned',
  TASK_ASSIGNMENT_ACCEPTED: 'task_assignment_accepted',
  TASK_ASSIGNMENT_REJECTED: 'task_assignment_rejected',
  TASK_STATUS_CHANGED: 'task_status_changed',
  TASK_COMPLETED: 'task_completed',
  TASK_OVERDUE: 'task_overdue',
  TASK_REVIEW_REJECTED: 'task_review_rejected',
  
  // Comments/Timeline
  PROJECT_COMMENT_ADDED: 'project_comment_added',
}

/**
 * Get user ID from employee ID
 * @param {string} employeeId - Employee ID
 * @param {Object} models - Optional tenant-aware models { User }
 */
async function getUserIdFromEmployee(employeeId, models = {}) {
  const User = models.User || DefaultUser
  if (!models.User) {
    await connectDB()
  }
  const userRecord = await User.findOne({ employeeId }).select('_id')
  return userRecord?._id
}

/**
 * Get user IDs from multiple employee IDs
 * @param {string[]} employeeIds - Array of Employee IDs
 * @param {Object} models - Optional tenant-aware models { User }
 */
async function getUserIdsFromEmployees(employeeIds, models = {}) {
  const User = models.User || DefaultUser
  if (!models.User) {
    await connectDB()
  }
  const users = await User.find({ employeeId: { $in: employeeIds } }).select('_id employeeId')
  return users.map(u => u._id)
}

/**
 * Get employee name by ID
 * @param {string} employeeId - Employee ID
 * @param {Object} models - Optional tenant-aware models { Employee }
 */
async function getEmployeeName(employeeId, models = {}) {
  const Employee = models.Employee || DefaultEmployee
  if (!models.Employee) {
    await connectDB()
  }
  const employee = await Employee.findById(employeeId).select('firstName lastName')
  return employee ? `${employee.firstName} ${employee.lastName}` : 'Someone'
}

// ============================================
// PROJECT-LEVEL NOTIFICATIONS
// ============================================

/**
 * Send notification when user is invited to a project
 * @param {Object} project - Project document
 * @param {Object} invitedEmployee - Employee being invited
 * @param {Object} inviterEmployee - Employee sending the invitation
 * @param {Object} models - Optional tenant-aware models { User, Employee, Notification }
 * @param {string} role - Role being invited for ('head' or 'member')
 */
export async function notifyProjectInvitation(project, invitedEmployee, inviterEmployee, models = {}, role = 'member') {
  const userId = await getUserIdFromEmployee(invitedEmployee._id, models)
  if (!userId) return
  
  const inviterName = `${inviterEmployee.firstName} ${inviterEmployee.lastName}`
  const roleLabel = role === 'head' ? 'Project Head' : 'team member'
  
  await sendPushToUser(userId, {
    title: role === 'head' ? 'Project Head Invitation' : 'Project Invitation',
    body: `${inviterName} invited you to join "${project.name}" as ${roleLabel}`
  }, {
    type: PROJECT_NOTIFICATION_TYPES.PROJECT_INVITATION,
    url: `/dashboard/projects/${project._id}?tab=invitation`,
    data: {
      projectId: project._id.toString(),
      projectName: project.name,
      inviterId: inviterEmployee._id.toString(),
      action: 'accept_reject',
      role: role
    },
    models
  })
}

/**
 * Send notification when user accepts project invitation
 * @param {Object} models - Optional tenant-aware models { User, Employee, Notification }
 */
export async function notifyProjectInvitationAccepted(project, acceptedEmployee, notifyUserIds, models = {}) {
  if (!notifyUserIds || notifyUserIds.length === 0) return
  
  const employeeName = `${acceptedEmployee.firstName} ${acceptedEmployee.lastName}`
  
  await sendPushToUsers(notifyUserIds, {
    title: 'Invitation Accepted',
    body: `${employeeName} accepted the invitation to join "${project.name}"`
  }, {
    type: PROJECT_NOTIFICATION_TYPES.PROJECT_INVITATION_ACCEPTED,
    url: `/dashboard/projects/${project._id}`,
    data: {
      projectId: project._id.toString(),
      projectName: project.name,
      acceptedBy: acceptedEmployee._id.toString()
    },
    models
  })
}

/**
 * Send notification when user rejects project invitation
 * @param {Object} models - Optional tenant-aware models { User, Employee, Notification }
 */
export async function notifyProjectInvitationRejected(project, rejectedEmployee, notifyUserIds, reason, models = {}) {
  if (!notifyUserIds || notifyUserIds.length === 0) return
  
  const employeeName = `${rejectedEmployee.firstName} ${rejectedEmployee.lastName}`
  
  await sendPushToUsers(notifyUserIds, {
    title: 'Invitation Rejected',
    body: `${employeeName} declined the invitation to join "${project.name}"${reason ? `: ${reason}` : ''}`
  }, {
    type: PROJECT_NOTIFICATION_TYPES.PROJECT_INVITATION_REJECTED,
    url: `/dashboard/projects/${project._id}`,
    data: {
      projectId: project._id.toString(),
      projectName: project.name,
      rejectedBy: rejectedEmployee._id.toString(),
      reason
    },
    models
  })
}

/**
 * Send notification when project completion is requested
 * @param {Object} models - Optional tenant-aware models { User, Employee, Notification }
 */
export async function notifyProjectCompletionRequested(project, requesterEmployee, models = {}) {
  const projectHeadUserId = await getUserIdFromEmployee(project.projectHead, models)
  if (!projectHeadUserId) return
  
  const requesterName = `${requesterEmployee.firstName} ${requesterEmployee.lastName}`
  
  await sendPushToUser(projectHeadUserId, {
    title: 'Completion Approval Needed',
    body: `${requesterName} marked "${project.name}" as ready for completion approval`
  }, {
    type: PROJECT_NOTIFICATION_TYPES.PROJECT_COMPLETION_REQUESTED,
    url: `/dashboard/projects/${project._id}?tab=approval`,
    data: {
      projectId: project._id.toString(),
      projectName: project.name,
      requestedBy: requesterEmployee._id.toString()
    },
    models
  })
}

/**
 * Send notification when project is approved
 * @param {Object} models - Optional tenant-aware models { User, Employee, Notification }
 */
export async function notifyProjectApproved(project, approverEmployee, memberUserIds, remark, models = {}) {
  if (!memberUserIds || memberUserIds.length === 0) return
  
  const approverName = `${approverEmployee.firstName} ${approverEmployee.lastName}`
  
  await sendPushToUsers(memberUserIds, {
    title: 'Project Approved! 🎉',
    body: `"${project.name}" has been approved by ${approverName}${remark ? `: ${remark}` : ''}`
  }, {
    type: PROJECT_NOTIFICATION_TYPES.PROJECT_APPROVED,
    url: `/dashboard/projects/${project._id}`,
    data: {
      projectId: project._id.toString(),
      projectName: project.name,
      approvedBy: approverEmployee._id.toString(),
      remark
    },
    models
  })
}

/**
 * Send notification when project completion is rejected
 * @param {Object} models - Optional tenant-aware models { User, Employee, Notification }
 */
export async function notifyProjectRejected(project, rejectorEmployee, memberUserIds, remark, models = {}) {
  if (!memberUserIds || memberUserIds.length === 0) return
  
  const rejectorName = `${rejectorEmployee.firstName} ${rejectorEmployee.lastName}`
  
  await sendPushToUsers(memberUserIds, {
    title: 'Project Completion Rejected',
    body: `Completion of "${project.name}" was rejected by ${rejectorName}${remark ? `: ${remark}` : ''}`
  }, {
    type: PROJECT_NOTIFICATION_TYPES.PROJECT_REJECTED,
    url: `/dashboard/projects/${project._id}`,
    data: {
      projectId: project._id.toString(),
      projectName: project.name,
      rejectedBy: rejectorEmployee._id.toString(),
      remark
    },
    models
  })
}

/**
 * Send notification when member is added to project
 * @param {Object} models - Optional tenant-aware models { User, Employee, Notification }
 */
export async function notifyMemberAdded(project, addedEmployee, adderEmployee, models = {}) {
  const userId = await getUserIdFromEmployee(addedEmployee._id, models)
  if (!userId) return
  
  const adderName = `${adderEmployee.firstName} ${adderEmployee.lastName}`
  
  await sendPushToUser(userId, {
    title: 'Added to Project',
    body: `${adderName} added you to "${project.name}"`
  }, {
    type: PROJECT_NOTIFICATION_TYPES.PROJECT_MEMBER_ADDED,
    url: `/dashboard/projects/${project._id}`,
    data: {
      projectId: project._id.toString(),
      projectName: project.name,
      addedBy: adderEmployee._id.toString()
    },
    models
  })
}

/**
 * Send notification when member is removed from project
 * @param {Object} models - Optional tenant-aware models { User, Employee, Notification }
 */
export async function notifyMemberRemoved(project, removedEmployee, removerEmployee, models = {}) {
  const userId = await getUserIdFromEmployee(removedEmployee._id, models)
  if (!userId) return
  
  const removerName = `${removerEmployee.firstName} ${removerEmployee.lastName}`
  
  await sendPushToUser(userId, {
    title: 'Removed from Project',
    body: `${removerName} removed you from "${project.name}"`
  }, {
    type: PROJECT_NOTIFICATION_TYPES.PROJECT_MEMBER_REMOVED,
    url: `/dashboard/projects`,
    data: {
      projectId: project._id.toString(),
      projectName: project.name,
      removedBy: removerEmployee._id.toString()
    }
  })
}

// ============================================
// TASK-LEVEL NOTIFICATIONS
// ============================================

/**
 * Send notification when task is assigned
 */
export async function notifyTaskAssigned(project, task, assigneeEmployee, assignerEmployee, models = {}) {
  const userId = await getUserIdFromEmployee(assigneeEmployee._id, models)
  if (!userId) return
  
  const assignerName = `${assignerEmployee.firstName} ${assignerEmployee.lastName}`
  
  await sendPushToUser(userId, {
    title: 'New Task Assigned',
    body: `${assignerName} assigned you "${task.title}" in "${project.name}"`
  }, {
    type: PROJECT_NOTIFICATION_TYPES.TASK_ASSIGNED,
    url: `/dashboard/projects/${project._id}?task=${task._id}`,
    data: {
      projectId: project._id.toString(),
      projectName: project.name,
      taskId: task._id.toString(),
      taskTitle: task.title,
      assignedBy: assignerEmployee._id.toString()
    }
  })
}

/**
 * Send notification when task assignment is accepted
 */
export async function notifyTaskAssignmentAccepted(project, task, assigneeEmployee, notifyUserIds) {
  if (!notifyUserIds || notifyUserIds.length === 0) return
  
  const assigneeName = `${assigneeEmployee.firstName} ${assigneeEmployee.lastName}`
  
  await sendPushToUsers(notifyUserIds, {
    title: 'Task Accepted',
    body: `${assigneeName} accepted task "${task.title}" in "${project.name}"`
  }, {
    type: PROJECT_NOTIFICATION_TYPES.TASK_ASSIGNMENT_ACCEPTED,
    url: `/dashboard/projects/${project._id}?task=${task._id}`,
    data: {
      projectId: project._id.toString(),
      projectName: project.name,
      taskId: task._id.toString(),
      taskTitle: task.title,
      acceptedBy: assigneeEmployee._id.toString()
    }
  })
}

/**
 * Send notification when task assignment is rejected
 */
export async function notifyTaskAssignmentRejected(project, task, assigneeEmployee, notifyUserIds, reason) {
  if (!notifyUserIds || notifyUserIds.length === 0) return
  
  const assigneeName = `${assigneeEmployee.firstName} ${assigneeEmployee.lastName}`
  
  await sendPushToUsers(notifyUserIds, {
    title: 'Task Rejected',
    body: `${assigneeName} rejected task "${task.title}"${reason ? `: ${reason}` : ''}`
  }, {
    type: PROJECT_NOTIFICATION_TYPES.TASK_ASSIGNMENT_REJECTED,
    url: `/dashboard/projects/${project._id}?task=${task._id}`,
    data: {
      projectId: project._id.toString(),
      projectName: project.name,
      taskId: task._id.toString(),
      taskTitle: task.title,
      rejectedBy: assigneeEmployee._id.toString(),
      reason
    }
  })
}

/**
 * Send notification when task status changes
 */
export async function notifyTaskStatusChanged(project, task, changerEmployee, notifyUserIds, oldStatus, newStatus) {
  if (!notifyUserIds || notifyUserIds.length === 0) return
  
  const changerName = `${changerEmployee.firstName} ${changerEmployee.lastName}`
  
  const statusLabels = {
    'todo': 'To Do',
    'in-progress': 'In Progress',
    'review': 'In Review',
    'completed': 'Completed',
    'rejected': 'Rejected',
    'blocked': 'Blocked'
  }
  
  await sendPushToUsers(notifyUserIds, {
    title: 'Task Status Updated',
    body: `${changerName} moved "${task.title}" to ${statusLabels[newStatus] || newStatus}`
  }, {
    type: PROJECT_NOTIFICATION_TYPES.TASK_STATUS_CHANGED,
    url: `/dashboard/projects/${project._id}?task=${task._id}`,
    data: {
      projectId: project._id.toString(),
      projectName: project.name,
      taskId: task._id.toString(),
      taskTitle: task.title,
      changedBy: changerEmployee._id.toString(),
      oldStatus,
      newStatus
    }
  })
}

/**
 * Send notification for overdue tasks
 */
export async function notifyTaskOverdue(project, task, assigneeUserIds) {
  if (!assigneeUserIds || assigneeUserIds.length === 0) return
  
  await sendPushToUsers(assigneeUserIds, {
    title: 'Task Overdue ⚠️',
    body: `Task "${task.title}" in "${project.name}" is now overdue`
  }, {
    type: PROJECT_NOTIFICATION_TYPES.TASK_OVERDUE,
    url: `/dashboard/projects/${project._id}?task=${task._id}`,
    data: {
      projectId: project._id.toString(),
      projectName: project.name,
      taskId: task._id.toString(),
      taskTitle: task.title,
      dueDate: task.dueDate?.toISOString()
    }
  })
}

/**
 * Send notification when task review is rejected by project head
 */
export async function notifyTaskReviewRejected(project, task, rejectorEmployee, assigneeUserIds, reason, subtasksUnmarked = []) {
  if (!assigneeUserIds || assigneeUserIds.length === 0) return
  
  const rejectorName = `${rejectorEmployee.firstName} ${rejectorEmployee.lastName}`
  
  let body = `${rejectorName} rejected your task "${task.title}"`
  if (subtasksUnmarked.length > 0) {
    body += ` and marked ${subtasksUnmarked.length} subtask(s) as incomplete`
  }
  if (reason) {
    body += `: ${reason}`
  }
  
  await sendPushToUsers(assigneeUserIds, {
    title: 'Task Rejected ❌',
    body
  }, {
    type: PROJECT_NOTIFICATION_TYPES.TASK_REVIEW_REJECTED,
    url: `/dashboard/projects/${project._id}?task=${task._id}`,
    data: {
      projectId: project._id.toString(),
      projectName: project.name,
      taskId: task._id.toString(),
      taskTitle: task.title,
      rejectedBy: rejectorEmployee._id.toString(),
      reason,
      subtasksUnmarked
    }
  })
}

// ============================================
// COMMENT NOTIFICATIONS
// ============================================

/**
 * Send notification when comment is added
 */
export async function notifyCommentAdded(project, commenterEmployee, notifyUserIds, commentPreview, models = {}) {
  if (!notifyUserIds || notifyUserIds.length === 0) return
  
  const commenterName = `${commenterEmployee.firstName} ${commenterEmployee.lastName}`
  const preview = commentPreview.length > 50 ? commentPreview.substring(0, 50) + '...' : commentPreview
  
  await sendPushToUsers(notifyUserIds, {
    title: 'New Comment',
    body: `${commenterName} on "${project.name}": ${preview}`
  }, {
    type: PROJECT_NOTIFICATION_TYPES.PROJECT_COMMENT_ADDED,
    url: `/dashboard/projects/${project._id}?tab=timeline`,
    data: {
      projectId: project._id.toString(),
      projectName: project.name,
      commentedBy: commenterEmployee._id.toString()
    }
  })
}

/**
 * Helper to get all accepted member user IDs for a project
 * @param {string} projectId - Project ID
 * @param {string|null} excludeEmployeeId - Employee ID to exclude
 * @param {Object} models - Optional tenant-aware models { ProjectMember, User }
 */
export async function getProjectMemberUserIds(projectId, excludeEmployeeId = null, models = {}) {
  // Use tenant model if provided, otherwise fall back to static import
  const ProjectMember = models.ProjectMember || (await import('@/models/ProjectMember')).default
  
  const query = {
    project: projectId,
    invitationStatus: 'accepted'
  }
  
  if (excludeEmployeeId) {
    query.user = { $ne: excludeEmployeeId }
  }
  
  const members = await ProjectMember.find(query).select('user')
  const employeeIds = members.map(m => m.user)
  
  return getUserIdsFromEmployees(employeeIds, models)
}
