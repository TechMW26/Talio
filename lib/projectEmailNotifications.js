import fs from 'fs/promises'
import path from 'path'
import { sendEmail } from '@/lib/mailer'
import {
    wrapEmailTemplate,
    emailButton,
    emailDetailRow,
    emailDetailsTable,
    emailDivider,
    emailHeading,
    emailInfoBox,
    emailParagraph,
} from '@/lib/emailTemplate'
import { getProjectTaskStats } from '@/lib/projectService'

export const PROJECT_EMAIL_TRIGGER_TYPES = {
    PROJECT_CREATED: 'project_created',
    TASK_CREATED: 'task_created',
    PROJECT_STATUS_CHANGED: 'project_status_changed',
    TASK_STATUS_CHANGED: 'task_status_changed',
}

const EMAIL_RATE_LIMIT = {
    cooldownMinutes: 5,
    maxAutoRetries: 5,
    backoffMultiplier: 2,
}

const PROJECT_STATUS_LABELS = {
    planned: 'Planned',
    ongoing: 'In Progress',
    pending: 'Pending',
    on_hold: 'On Hold',
    overdue: 'Overdue',
    completed_pending_approval: 'Completed Pending Approval',
    completed: 'Completed',
    approved: 'Approved',
    rejected: 'Rejected',
    archived: 'Archived',
}

const TASK_STATUS_LABELS = {
    todo: 'To Do',
    'in-progress': 'In Progress',
    review: 'In Review',
    completed: 'Completed',
    'completed-pending-approval': 'Completed Pending Approval',
    rejected: 'Rejected',
    blocked: 'Blocked',
    archived: 'Archived',
}

const PRIORITY_LABELS = {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    critical: 'Critical',
}

function calculateNextRetryTime(retryCount) {
    const baseDelayMinutes = EMAIL_RATE_LIMIT.cooldownMinutes
    const backoffMinutes = baseDelayMinutes * Math.pow(EMAIL_RATE_LIMIT.backoffMultiplier, retryCount - 1)
    const maxDelayMinutes = 60
    const delayMinutes = Math.min(backoffMinutes, maxDelayMinutes)

    return new Date(Date.now() + delayMinutes * 60 * 1000)
}

function isRateLimitError(errorMessage) {
    if (!errorMessage) return false

    const rateLimitPatterns = [
        'rate',
        'limit',
        '451',
        '452',
        '421',
        'too many',
        'throttl',
        'slow down',
        'try again later',
        'temporarily',
        'deferred',
    ]

    const lowerError = errorMessage.toLowerCase()
    return rateLimitPatterns.some(pattern => lowerError.includes(pattern))
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function formatDate(value) {
    if (!value) return 'N/A'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return 'N/A'

    return new Intl.DateTimeFormat('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
    }).format(date)
}

function formatDateTime(value) {
    if (!value) return 'N/A'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return 'N/A'

    return new Intl.DateTimeFormat('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata',
    }).format(date)
}

function humanizeStatus(value, labels) {
    if (!value) return 'N/A'
    return labels[value] || value.replace(/[-_]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

function humanizePriority(value) {
    if (!value) return 'N/A'
    return PRIORITY_LABELS[value] || value.replace(/\b\w/g, letter => letter.toUpperCase())
}

function buildPersonName(record) {
    if (!record) return 'N/A'
    if (record.name) return record.name

    const firstName = record.firstName || ''
    const lastName = record.lastName || ''
    const fullName = `${firstName} ${lastName}`.trim()

    if (fullName) return fullName
    if (record.email) return record.email
    return 'N/A'
}

function buildListLabel(items, fallback = 'N/A') {
    if (!Array.isArray(items) || items.length === 0) return fallback
    return items.join(', ')
}

function getBaseUrl() {
    return process.env.NEXT_PUBLIC_BASE_URL || 'https://app.talio.in'
}

function getProjectUrl(projectId, taskId = null) {
    const baseUrl = getBaseUrl()
    if (taskId) {
        return `${baseUrl}/dashboard/projects/${projectId}?task=${taskId}`
    }
    return `${baseUrl}/dashboard/projects/${projectId}`
}

function pickProjectCode(project) {
    return project.projectCode || project.code || project.projectId || project._id?.toString() || 'N/A'
}

function pickProjectClientName(project) {
    return project.clientName || project.client?.name || project.metadata?.clientName || project.metadata?.client?.name || null
}

function pickProjectBudget(project) {
    const budget = project.budget ?? project.metadata?.budget
    return budget === undefined || budget === null || budget === '' ? null : String(budget)
}

function normalizeAttachmentInput(attachments) {
    if (!Array.isArray(attachments)) return []

    return attachments
        .filter(Boolean)
        .map(item => {
            if (typeof item === 'string') {
                return {
                    name: path.basename(item),
                    url: item,
                }
            }

            return item
        })
}

function pickProjectAttachments(project) {
    return normalizeAttachmentInput(project.attachments || project.metadata?.attachments || [])
}

function pickTaskAttachments(task) {
    return normalizeAttachmentInput(task.attachments || task.metadata?.attachments || [])
}

function resolveAttachmentSource(attachment) {
    return attachment.filePath || attachment.path || attachment.url || attachment.href || attachment.source || attachment.location || null
}

function resolveAttachmentName(attachment, source) {
    return attachment.name || attachment.fileName || attachment.filename || attachment.originalName || (source ? path.basename(source.split('?')[0]) : 'attachment')
}

async function validateRemoteAttachment(source) {
    try {
        const headResponse = await fetch(source, { method: 'HEAD' })
        if (headResponse.ok || headResponse.status === 405) {
            return { ok: true }
        }
    } catch {
        // Fall through to the GET probe below.
    }

    try {
        const getResponse = await fetch(source, {
            method: 'GET',
            headers: { Range: 'bytes=0-0' },
        })
        if (getResponse.ok || getResponse.status === 206) {
            return { ok: true }
        }

        return { ok: false, reason: `Remote file returned ${getResponse.status}` }
    } catch (error) {
        return { ok: false, reason: error.message || 'Remote file check failed' }
    }
}

async function prepareMailAttachments(attachments) {
    if (!Array.isArray(attachments) || attachments.length === 0) {
        return { mailAttachments: [], attachmentAudit: [] }
    }

    const resolved = await Promise.all(attachments.map(async attachment => {
        const source = resolveAttachmentSource(attachment)
        const name = resolveAttachmentName(attachment, source)

        if (!source) {
            return {
                mailAttachment: null,
                audit: {
                    name,
                    source: null,
                    status: 'missing',
                    reason: 'Missing attachment source',
                }
            }
        }

        if (/^https?:\/\//i.test(source)) {
            const validation = await validateRemoteAttachment(source)
            if (!validation.ok) {
                return {
                    mailAttachment: null,
                    audit: {
                        name,
                        source,
                        status: 'missing',
                        reason: validation.reason,
                    }
                }
            }

            return {
                mailAttachment: {
                    filename: name,
                    path: source,
                },
                audit: {
                    name,
                    source,
                    status: 'attached',
                    reason: null,
                }
            }
        }

        const resolvedPath = path.isAbsolute(source) ? source : path.resolve(process.cwd(), source)

        try {
            await fs.access(resolvedPath)
            return {
                mailAttachment: {
                    filename: name,
                    path: resolvedPath,
                },
                audit: {
                    name,
                    source: resolvedPath,
                    status: 'attached',
                    reason: null,
                }
            }
        } catch (error) {
            return {
                mailAttachment: null,
                audit: {
                    name,
                    source: resolvedPath,
                    status: 'missing',
                    reason: error.message || 'Attachment file not accessible',
                }
            }
        }
    }))

    return {
        mailAttachments: resolved.filter(item => item.mailAttachment).map(item => item.mailAttachment),
        attachmentAudit: resolved.map(item => item.audit),
    }
}

function buildAttachmentNotice(attachmentAudit) {
    if (!Array.isArray(attachmentAudit) || attachmentAudit.length === 0) return ''

    const attachedCount = attachmentAudit.filter(item => item.status === 'attached').length
    const missingCount = attachmentAudit.filter(item => item.status === 'missing').length
    const parts = []

    if (attachedCount > 0) {
        parts.push(`${attachedCount} attachment${attachedCount === 1 ? '' : 's'} included`)
    }

    if (missingCount > 0) {
        parts.push(`${missingCount} unavailable and skipped`)
    }

    if (parts.length === 0) return ''
    return emailInfoBox(escapeHtml(parts.join('. ') + '.'), missingCount > 0 ? 'warning' : 'info')
}

function buildRows(details) {
    return details
        .filter(item => item.value !== undefined && item.value !== null && item.value !== '')
        .map(item => emailDetailRow(escapeHtml(item.label), escapeHtml(item.value)))
        .join('')
}

function buildFooter() {
    return `${emailDivider()}${emailParagraph('This is an automated notification from Talio HRMS. Please do not reply.', true)}`
}

function buildEmailShell({ title, preheader, intro, summaryRows, statusBox, attachmentNotice, actionLabel, actionUrl, footerExtra = '' }) {
    const content = `
    <div style="margin-bottom: 16px;">
      <p style="margin: 0 0 6px 0; color: #64748b; font-size: 12px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;">Talio HRMS</p>
      ${emailHeading(escapeHtml(title))}
    </div>
    ${emailParagraph(intro)}
    ${statusBox || ''}
    ${emailDetailsTable(summaryRows)}
    ${attachmentNotice || ''}
    <div style="margin-top: 18px;">${emailButton(escapeHtml(actionLabel), actionUrl)}</div>
    ${footerExtra}
    ${buildFooter()}
  `

    return wrapEmailTemplate({
        title,
        preheader,
        content,
        accentColor: '#2563eb',
    })
}

async function getEmployeeProfiles(employeeIds, models) {
    if (!Array.isArray(employeeIds) || employeeIds.length === 0) return new Map()

    const uniqueEmployeeIds = [...new Set(employeeIds.map(id => id.toString()))]
    const { Employee, User } = models

    const [employees, users] = await Promise.all([
        Employee.find({ _id: { $in: uniqueEmployeeIds } })
            .select('firstName lastName email employeeCode')
            .lean(),
        User.find({ employeeId: { $in: uniqueEmployeeIds } })
            .select('_id employeeId email')
            .lean(),
    ])

    const userByEmployeeId = new Map(users.map(user => [user.employeeId.toString(), user]))

    return new Map(employees.map(employee => {
        const user = userByEmployeeId.get(employee._id.toString()) || null
        return [employee._id.toString(), {
            employeeId: employee._id.toString(),
            userId: user?._id?.toString() || null,
            email: employee.email || user?.email || null,
            name: buildPersonName(employee),
            employeeCode: employee.employeeCode || null,
        }]
    }))
}

async function getProjectMemberProfiles(projectId, models, roles = null) {
    const { ProjectMember } = models

    const query = {
        project: projectId,
        invitationStatus: { $in: ['invited', 'accepted'] },
    }

    if (Array.isArray(roles) && roles.length > 0) {
        query.role = { $in: roles }
    }

    const memberships = await ProjectMember.find(query)
        .select('user role invitationStatus')
        .lean()

    const profileMap = await getEmployeeProfiles(memberships.map(member => member.user), models)

    return memberships
        .map(member => {
            const profile = profileMap.get(member.user.toString())
            if (!profile?.email) return null

            return {
                ...profile,
                role: member.role,
                invitationStatus: member.invitationStatus,
            }
        })
        .filter(Boolean)
}

async function getTaskAssigneeProfiles(taskId, models) {
    const { TaskAssignee } = models

    const assignments = await TaskAssignee.find({
        task: taskId,
        assignmentStatus: { $in: ['pending', 'accepted'] },
    })
        .select('user assignmentStatus')
        .lean()

    const profileMap = await getEmployeeProfiles(assignments.map(assignment => assignment.user), models)

    return assignments
        .map(assignment => {
            const profile = profileMap.get(assignment.user.toString())
            if (!profile?.email) return null

            return {
                ...profile,
                assignmentStatus: assignment.assignmentStatus,
            }
        })
        .filter(Boolean)
}

function dedupeRecipients(recipients) {
    const seen = new Set()
    return recipients.filter(recipient => {
        const key = recipient.employeeId || recipient.email?.toLowerCase()
        if (!key || seen.has(key)) return false
        seen.add(key)
        return true
    })
}

async function getProjectContext(projectId, models) {
    const { Project } = models
    return Project.findById(projectId)
        .populate('projectHead', 'firstName lastName email employeeCode')
        .populate('projectHeads', 'firstName lastName email employeeCode')
        .populate('createdBy', 'firstName lastName email employeeCode')
        .populate('department', 'name code')
        .populate('projectManager', 'firstName lastName email employeeCode')
        .populate('assignedTeams', 'teamName teamCode')
        .lean()
}

async function getTaskContext(taskId, models) {
    const { Task } = models
    return Task.findById(taskId)
        .populate('createdBy', 'firstName lastName email employeeCode')
        .populate('assignedBy', 'firstName lastName email employeeCode')
        .lean()
}

function buildProjectHeads(project) {
    const heads = Array.isArray(project.projectHeads) && project.projectHeads.length > 0
        ? project.projectHeads
        : (project.projectHead ? [project.projectHead] : [])

    return [...new Set(heads.map(head => buildPersonName(head)).filter(Boolean))]
}

function buildProjectMemberNames(memberProfiles) {
    return memberProfiles
        .filter(member => member.role !== 'head')
        .map(member => member.name)
}

function buildTaskAssigneeNames(assignees) {
    return assignees.map(assignee => assignee.name)
}

function buildProjectCreatedPayload({ project, memberProfiles, attachmentAudit, mailAttachments }) {
    const headNames = buildProjectHeads(project)
    const memberNames = buildProjectMemberNames(memberProfiles)
    const projectCode = pickProjectCode(project)
    const clientName = pickProjectClientName(project)
    const budget = pickProjectBudget(project)
    const department = project.department?.name || project.departmentName || project.metadata?.departmentName || null
    const subject = `New Project Created - ${project.name}`
    const actionUrl = getProjectUrl(project._id)
    const summaryRows = buildRows([
        { label: 'Project Name', value: project.name },
        { label: 'Project Code / ID', value: projectCode },
        { label: 'Client Name', value: clientName },
        { label: 'Project Description', value: project.description || 'N/A' },
        { label: 'Start Date', value: formatDate(project.startDate) },
        { label: 'End Date / Deadline', value: formatDate(project.endDate) },
        { label: 'Priority', value: humanizePriority(project.priority) },
        { label: 'Status', value: humanizeStatus(project.status, PROJECT_STATUS_LABELS) },
        { label: 'Assigned Heads', value: buildListLabel(headNames) },
        { label: 'Assigned Members', value: buildListLabel(memberNames) },
        { label: 'Department', value: department },
        { label: 'Budget', value: budget },
        { label: 'Project Manager', value: project.projectManager ? buildPersonName(project.projectManager) : null },
        { label: 'Assigned Teams', value: Array.isArray(project.assignedTeams) && project.assignedTeams.length > 0 ? buildListLabel(project.assignedTeams.map(team => `${team.teamName}${team.teamCode ? ` (${team.teamCode})` : ''}`)) : null },
        { label: 'Created By', value: buildPersonName(project.createdBy) },
        { label: 'Created Date & Time', value: formatDateTime(project.createdAt) },
    ])

    const attachmentNotice = buildAttachmentNotice(attachmentAudit)
    const statusBox = emailInfoBox(`Current status: <strong>${escapeHtml(humanizeStatus(project.status, PROJECT_STATUS_LABELS))}</strong>`, 'info')
    const html = buildEmailShell({
        title: 'New Project Created',
        preheader: `A new project named ${project.name} has been created in Talio HRMS.`,
        intro: `A new project has been created and assigned to your project workspace. Review the summary below for the latest details.`,
        summaryRows,
        statusBox,
        attachmentNotice,
        actionLabel: 'View Project',
        actionUrl,
    })

    const text = [
        'Talio HRMS',
        '',
        'New Project Created',
        '',
        `Project Name: ${project.name}`,
        `Project Code / ID: ${projectCode}`,
        clientName ? `Client Name: ${clientName}` : null,
        `Project Description: ${project.description || 'N/A'}`,
        `Start Date: ${formatDate(project.startDate)}`,
        `End Date / Deadline: ${formatDate(project.endDate)}`,
        `Priority: ${humanizePriority(project.priority)}`,
        `Status: ${humanizeStatus(project.status, PROJECT_STATUS_LABELS)}`,
        `Assigned Heads: ${buildListLabel(headNames)}`,
        `Assigned Members: ${buildListLabel(memberNames)}`,
        department ? `Department: ${department}` : null,
        budget ? `Budget: ${budget}` : null,
        project.projectManager ? `Project Manager: ${buildPersonName(project.projectManager)}` : null,
        `Created By: ${buildPersonName(project.createdBy)}`,
        `Created Date & Time: ${formatDateTime(project.createdAt)}`,
        attachmentAudit.length > 0 ? `Attachments: ${attachmentAudit.filter(item => item.status === 'attached').length} attached, ${attachmentAudit.filter(item => item.status === 'missing').length} skipped` : null,
        '',
        `View Project: ${actionUrl}`,
        '',
        'This is an automated notification from Talio HRMS. Please do not reply.',
    ].filter(Boolean).join('\n')

    return { subject, html, text, actionUrl, mailAttachments, attachmentAudit }
}

function buildTaskCreatedPayload({ project, task, assignees, attachmentAudit, mailAttachments }) {
    const assigneeNames = buildTaskAssigneeNames(assignees)
    const subject = `New Task Created in ${project.name} - ${task.title}`
    const actionUrl = getProjectUrl(project._id, task._id)
    const summaryRows = buildRows([
        { label: 'Project Name', value: project.name },
        { label: 'Task Name', value: task.title },
        { label: 'Task Description', value: task.description || 'N/A' },
        { label: 'Assigned To', value: buildListLabel(assigneeNames) },
        { label: 'Priority', value: humanizePriority(task.priority) },
        { label: 'Due Date', value: formatDate(task.dueDate) },
        { label: 'Current Project Status', value: humanizeStatus(project.status, PROJECT_STATUS_LABELS) },
        { label: 'Current Task Status', value: humanizeStatus(task.status, TASK_STATUS_LABELS) },
        { label: 'Created By', value: buildPersonName(task.createdBy) },
        { label: 'Created Date & Time', value: formatDateTime(task.createdAt) },
    ])

    const attachmentNotice = buildAttachmentNotice(attachmentAudit)
    const statusBox = emailInfoBox(`Task status: <strong>${escapeHtml(humanizeStatus(task.status, TASK_STATUS_LABELS))}</strong>`, 'info')
    const html = buildEmailShell({
        title: 'New Task Created',
        preheader: `A new task named ${task.title} has been created in ${project.name}.`,
        intro: `A new task has been created under the project workspace. Review the task summary below.`,
        summaryRows,
        statusBox,
        attachmentNotice,
        actionLabel: 'View Task',
        actionUrl,
    })

    const text = [
        'Talio HRMS',
        '',
        'New Task Created',
        '',
        `Project Name: ${project.name}`,
        `Task Name: ${task.title}`,
        `Task Description: ${task.description || 'N/A'}`,
        `Assigned To: ${buildListLabel(assigneeNames)}`,
        `Priority: ${humanizePriority(task.priority)}`,
        `Due Date: ${formatDate(task.dueDate)}`,
        `Current Project Status: ${humanizeStatus(project.status, PROJECT_STATUS_LABELS)}`,
        `Current Task Status: ${humanizeStatus(task.status, TASK_STATUS_LABELS)}`,
        `Created By: ${buildPersonName(task.createdBy)}`,
        `Created Date & Time: ${formatDateTime(task.createdAt)}`,
        attachmentAudit.length > 0 ? `Attachments: ${attachmentAudit.filter(item => item.status === 'attached').length} attached, ${attachmentAudit.filter(item => item.status === 'missing').length} skipped` : null,
        '',
        `View Task: ${actionUrl}`,
        '',
        'This is an automated notification from Talio HRMS. Please do not reply.',
    ].filter(Boolean).join('\n')

    return { subject, html, text, actionUrl, mailAttachments, attachmentAudit }
}

function buildProjectStatusChangedPayload({ project, oldStatus, newStatus, taskStats, eventTimestamp }) {
    const subject = `Project Status Updated - ${project.name}`
    const actionUrl = getProjectUrl(project._id)
    const progressLabel = `${project.completionPercentage || 0}% complete`
    const summaryRows = buildRows([
        { label: 'Project Name', value: project.name },
        { label: 'Previous Status', value: humanizeStatus(oldStatus, PROJECT_STATUS_LABELS) },
        { label: 'New Status', value: humanizeStatus(newStatus, PROJECT_STATUS_LABELS) },
        { label: 'Updated By', value: buildPersonName(project.lastStatusUpdatedBy || project.updatedBy || project.createdBy) },
        { label: 'Updated Date & Time', value: formatDateTime(eventTimestamp) },
        { label: 'Project Summary', value: project.description || 'N/A' },
        { label: 'Progress Details', value: `${progressLabel}${taskStats ? ` | Tasks: ${taskStats.completed}/${taskStats.total} completed, ${taskStats.inProgress} in progress, ${taskStats.overdue} overdue` : ''}` },
    ])

    const statusBox = emailInfoBox(
        `Status changed from <strong>${escapeHtml(humanizeStatus(oldStatus, PROJECT_STATUS_LABELS))}</strong> to <strong>${escapeHtml(humanizeStatus(newStatus, PROJECT_STATUS_LABELS))}</strong>.`,
        newStatus === 'completed' || newStatus === 'approved' ? 'success' : 'info'
    )
    const html = buildEmailShell({
        title: 'Project Status Updated',
        preheader: `${project.name} moved from ${humanizeStatus(oldStatus, PROJECT_STATUS_LABELS)} to ${humanizeStatus(newStatus, PROJECT_STATUS_LABELS)}.`,
        intro: `A project status update has been recorded in Talio HRMS. Review the latest summary below.`,
        summaryRows,
        statusBox,
        attachmentNotice: '',
        actionLabel: 'Open Project',
        actionUrl,
    })

    const text = [
        'Talio HRMS',
        '',
        'Project Status Updated',
        '',
        `Project Name: ${project.name}`,
        `Previous Status: ${humanizeStatus(oldStatus, PROJECT_STATUS_LABELS)}`,
        `New Status: ${humanizeStatus(newStatus, PROJECT_STATUS_LABELS)}`,
        `Updated By: ${buildPersonName(project.lastStatusUpdatedBy || project.updatedBy || project.createdBy)}`,
        `Updated Date & Time: ${formatDateTime(eventTimestamp)}`,
        `Project Summary: ${project.description || 'N/A'}`,
        `Progress Details: ${progressLabel}${taskStats ? ` | Tasks: ${taskStats.completed}/${taskStats.total} completed, ${taskStats.inProgress} in progress, ${taskStats.overdue} overdue` : ''}`,
        '',
        `Open Project: ${actionUrl}`,
        '',
        'This is an automated notification from Talio HRMS. Please do not reply.',
    ].filter(Boolean).join('\n')

    return { subject, html, text, actionUrl, mailAttachments: [], attachmentAudit: [] }
}

function buildTaskStatusChangedPayload({ project, task, assignees, oldStatus, newStatus, updatedBy, eventTimestamp }) {
    const subject = `Task Status Updated - ${task.title}`
    const actionUrl = getProjectUrl(project._id, task._id)
    const assigneeNames = buildTaskAssigneeNames(assignees)
    const summaryRows = buildRows([
        { label: 'Project Name', value: project.name },
        { label: 'Task Name', value: task.title },
        { label: 'Assigned To', value: buildListLabel(assigneeNames) },
        { label: 'Old Status', value: humanizeStatus(oldStatus, TASK_STATUS_LABELS) },
        { label: 'New Status', value: humanizeStatus(newStatus, TASK_STATUS_LABELS) },
        { label: 'Updated By', value: buildPersonName(updatedBy) },
        { label: 'Updated Time', value: formatDateTime(eventTimestamp) },
        { label: 'Current Project Status', value: humanizeStatus(project.status, PROJECT_STATUS_LABELS) },
    ])

    const statusBox = emailInfoBox(
        `Task status changed from <strong>${escapeHtml(humanizeStatus(oldStatus, TASK_STATUS_LABELS))}</strong> to <strong>${escapeHtml(humanizeStatus(newStatus, TASK_STATUS_LABELS))}</strong>.`,
        newStatus === 'completed' ? 'success' : 'info'
    )
    const html = buildEmailShell({
        title: 'Task Status Updated',
        preheader: `${task.title} moved from ${humanizeStatus(oldStatus, TASK_STATUS_LABELS)} to ${humanizeStatus(newStatus, TASK_STATUS_LABELS)}.`,
        intro: `A task status update has been recorded in Talio HRMS. Review the latest update below.`,
        summaryRows,
        statusBox,
        attachmentNotice: '',
        actionLabel: 'Review Task',
        actionUrl,
    })

    const text = [
        'Talio HRMS',
        '',
        'Task Status Updated',
        '',
        `Project Name: ${project.name}`,
        `Task Name: ${task.title}`,
        `Assigned To: ${buildListLabel(assigneeNames)}`,
        `Old Status: ${humanizeStatus(oldStatus, TASK_STATUS_LABELS)}`,
        `New Status: ${humanizeStatus(newStatus, TASK_STATUS_LABELS)}`,
        `Updated By: ${buildPersonName(updatedBy)}`,
        `Updated Time: ${formatDateTime(eventTimestamp)}`,
        `Current Project Status: ${humanizeStatus(project.status, PROJECT_STATUS_LABELS)}`,
        '',
        `Review Task: ${actionUrl}`,
        '',
        'This is an automated notification from Talio HRMS. Please do not reply.',
    ].filter(Boolean).join('\n')

    return { subject, html, text, actionUrl, mailAttachments: [], attachmentAudit: [] }
}

async function queueNotificationLogs({
    triggerType,
    projectId,
    taskId = null,
    recipients,
    subject,
    text,
    html,
    mailAttachments,
    attachmentAudit,
    eventTimestamp,
    triggeredByEmployeeId = null,
    triggeredByUserId = null,
    payload = {},
    models,
}) {
    const { ProjectEmailNotificationLog } = models
    const normalizedRecipients = dedupeRecipients(recipients).filter(recipient => recipient.email)

    if (normalizedRecipients.length === 0) {
        return { queuedCount: 0, skippedCount: 0 }
    }

    const eventToken = new Date(eventTimestamp || new Date()).toISOString()
    const triggerKeys = normalizedRecipients.map(recipient => `${triggerType}:${projectId}:${taskId || 'none'}:${eventToken}:${recipient.email.toLowerCase()}`)

    const existingLogs = await ProjectEmailNotificationLog.find({ triggerKey: { $in: triggerKeys } })
        .select('triggerKey')
        .lean()

    const existingKeys = new Set(existingLogs.map(log => log.triggerKey))
    const scheduledFor = new Date()

    const logsToCreate = normalizedRecipients
        .map((recipient, index) => ({ recipient, triggerKey: triggerKeys[index] }))
        .filter(item => !existingKeys.has(item.triggerKey))
        .map(item => ({
            triggerType,
            triggerKey: item.triggerKey,
            project: projectId,
            task: taskId,
            recipientEmployee: item.recipient.employeeId || null,
            recipientUser: item.recipient.userId || null,
            recipientEmail: item.recipient.email.toLowerCase(),
            recipientName: item.recipient.name,
            subject,
            status: 'pending',
            queued: true,
            scheduledFor,
            triggeredByEmployee: triggeredByEmployeeId,
            triggeredByUser: triggeredByUserId,
            payload: {
                subject,
                text,
                html,
                attachments: mailAttachments,
                ...payload,
            },
            attachments: attachmentAudit,
        }))

    if (logsToCreate.length === 0) {
        return { queuedCount: 0, skippedCount: normalizedRecipients.length }
    }

    const createdLogs = await ProjectEmailNotificationLog.insertMany(logsToCreate, { ordered: false })

    for (const log of createdLogs) {
        void processProjectEmailNotificationLog(log, models).catch(error => {
            console.error('[ProjectEmailNotifications] Immediate send failed:', error)
        })
    }

    return {
        queuedCount: createdLogs.length,
        skippedCount: normalizedRecipients.length - createdLogs.length,
    }
}

export async function processProjectEmailNotificationLog(logOrId, models) {
    const { ProjectEmailNotificationLog } = models

    const emailLog = typeof logOrId === 'object' && logOrId?._id
        ? logOrId
        : await ProjectEmailNotificationLog.findById(logOrId)

    if (!emailLog) {
        return { success: false, error: 'Email log not found' }
    }

    if (emailLog.status === 'sent') {
        return { success: true, skipped: true }
    }

    if ((emailLog.autoRetryCount || 0) > 0) {
        emailLog.retryCount = (emailLog.retryCount || 0) + 1
        emailLog.lastRetryAt = new Date()
    }

    emailLog.queued = false
    emailLog.scheduledFor = null

    const payload = emailLog.payload || {}

    try {
        const result = await sendEmail({
            to: emailLog.recipientEmail,
            subject: emailLog.subject,
            text: payload.text,
            html: payload.html,
            attachments: payload.attachments,
        })

        emailLog.status = 'sent'
        emailLog.sentAt = new Date()
        emailLog.errorMessage = null
        emailLog.rateLimitedUntil = null
        emailLog.providerMessageId = result?.messageId || null
        await emailLog.save()

        return { success: true, emailLogId: emailLog._id }
    } catch (error) {
        if (isRateLimitError(error.message)) {
            emailLog.autoRetryCount = (emailLog.autoRetryCount || 0) + 1

            if (emailLog.autoRetryCount < EMAIL_RATE_LIMIT.maxAutoRetries) {
                emailLog.status = 'pending'
                emailLog.queued = true
                emailLog.scheduledFor = calculateNextRetryTime(emailLog.autoRetryCount)
                emailLog.rateLimitedUntil = emailLog.scheduledFor
                emailLog.errorMessage = `Rate limited. Auto-retry ${emailLog.autoRetryCount}/${EMAIL_RATE_LIMIT.maxAutoRetries} scheduled for ${emailLog.scheduledFor.toISOString()}`
                await emailLog.save()

                return {
                    success: false,
                    rateLimited: true,
                    emailLogId: emailLog._id,
                    scheduledFor: emailLog.scheduledFor,
                    error: emailLog.errorMessage,
                }
            }
        }

        emailLog.status = 'failed'
        emailLog.errorMessage = error.message || 'Unknown error'
        await emailLog.save()

        return {
            success: false,
            emailLogId: emailLog._id,
            error: emailLog.errorMessage,
        }
    }
}

export async function queueProjectCreatedEmailNotifications({
    projectId,
    triggeredByEmployeeId = null,
    triggeredByUserId = null,
    models,
}) {
    const [project, memberProfiles] = await Promise.all([
        getProjectContext(projectId, models),
        getProjectMemberProfiles(projectId, models),
    ])

    if (!project) return { queuedCount: 0, skippedCount: 0 }

    const { mailAttachments, attachmentAudit } = await prepareMailAttachments(pickProjectAttachments(project))
    const payload = buildProjectCreatedPayload({
        project,
        memberProfiles,
        attachmentAudit,
        mailAttachments,
    })

    return queueNotificationLogs({
        triggerType: PROJECT_EMAIL_TRIGGER_TYPES.PROJECT_CREATED,
        projectId: project._id,
        recipients: memberProfiles,
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
        mailAttachments: payload.mailAttachments,
        attachmentAudit: payload.attachmentAudit,
        eventTimestamp: project.createdAt || new Date(),
        triggeredByEmployeeId,
        triggeredByUserId,
        payload: { actionUrl: payload.actionUrl },
        models,
    })
}

export async function queueTaskCreatedEmailNotifications({
    projectId,
    taskId,
    triggeredByEmployeeId = null,
    triggeredByUserId = null,
    models,
}) {
    const [project, task, projectMembers, assignees] = await Promise.all([
        getProjectContext(projectId, models),
        getTaskContext(taskId, models),
        getProjectMemberProfiles(projectId, models),
        getTaskAssigneeProfiles(taskId, models),
    ])

    if (!project || !task) return { queuedCount: 0, skippedCount: 0 }

    const { mailAttachments, attachmentAudit } = await prepareMailAttachments(pickTaskAttachments(task))
    const payload = buildTaskCreatedPayload({
        project,
        task,
        assignees,
        attachmentAudit,
        mailAttachments,
    })

    return queueNotificationLogs({
        triggerType: PROJECT_EMAIL_TRIGGER_TYPES.TASK_CREATED,
        projectId: project._id,
        taskId: task._id,
        recipients: dedupeRecipients([...projectMembers, ...assignees]),
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
        mailAttachments: payload.mailAttachments,
        attachmentAudit: payload.attachmentAudit,
        eventTimestamp: task.createdAt || new Date(),
        triggeredByEmployeeId,
        triggeredByUserId,
        payload: { actionUrl: payload.actionUrl },
        models,
    })
}

export async function queueProjectStatusChangedEmailNotifications({
    projectId,
    oldStatus,
    newStatus,
    changedByEmployeeId = null,
    triggeredByUserId = null,
    eventTimestamp = new Date(),
    models,
}) {
    const [project, memberProfiles, taskStats, changedByProfiles] = await Promise.all([
        getProjectContext(projectId, models),
        getProjectMemberProfiles(projectId, models),
        getProjectTaskStats(projectId, models).catch(() => null),
        getEmployeeProfiles(changedByEmployeeId ? [changedByEmployeeId] : [], models),
    ])

    if (!project) return { queuedCount: 0, skippedCount: 0 }

    project.lastStatusUpdatedBy = changedByProfiles.get(changedByEmployeeId?.toString()) || null

    const payload = buildProjectStatusChangedPayload({
        project,
        oldStatus,
        newStatus,
        taskStats,
        eventTimestamp,
    })

    return queueNotificationLogs({
        triggerType: PROJECT_EMAIL_TRIGGER_TYPES.PROJECT_STATUS_CHANGED,
        projectId: project._id,
        recipients: memberProfiles,
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
        mailAttachments: payload.mailAttachments,
        attachmentAudit: payload.attachmentAudit,
        eventTimestamp,
        triggeredByEmployeeId: changedByEmployeeId,
        triggeredByUserId,
        payload: { actionUrl: payload.actionUrl, oldStatus, newStatus },
        models,
    })
}

export async function queueTaskStatusChangedEmailNotifications({
    projectId,
    taskId,
    oldStatus,
    newStatus,
    changedByEmployeeId = null,
    triggeredByUserId = null,
    eventTimestamp = new Date(),
    includeProjectMembers = false,
    includeHeads = true,
    includeAssignees = true,
    includeTaskCreator = true,
    models,
}) {
    const [project, task, headProfiles, assignees, changedByProfiles, projectMembers] = await Promise.all([
        getProjectContext(projectId, models),
        getTaskContext(taskId, models),
        getProjectMemberProfiles(projectId, models, ['head']),
        getTaskAssigneeProfiles(taskId, models),
        getEmployeeProfiles(changedByEmployeeId ? [changedByEmployeeId] : [], models),
        includeProjectMembers ? getProjectMemberProfiles(projectId, models) : Promise.resolve([]),
    ])

    if (!project || !task) return { queuedCount: 0, skippedCount: 0 }

    const creatorMap = await getEmployeeProfiles(task.createdBy ? [task.createdBy._id || task.createdBy] : [], models)
    const taskCreator = creatorMap.get((task.createdBy?._id || task.createdBy || '').toString()) || null
    const changedBy = changedByProfiles.get(changedByEmployeeId?.toString()) || null

    const payload = buildTaskStatusChangedPayload({
        project,
        task,
        assignees,
        oldStatus,
        newStatus,
        updatedBy: changedBy,
        eventTimestamp,
    })

    const recipients = dedupeRecipients([
        ...(includeHeads ? headProfiles : []),
        ...(includeAssignees ? assignees : []),
        ...(includeTaskCreator && taskCreator ? [taskCreator] : []),
        ...(includeProjectMembers ? projectMembers : []),
    ])

    return queueNotificationLogs({
        triggerType: PROJECT_EMAIL_TRIGGER_TYPES.TASK_STATUS_CHANGED,
        projectId: project._id,
        taskId: task._id,
        recipients,
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
        mailAttachments: payload.mailAttachments,
        attachmentAudit: payload.attachmentAudit,
        eventTimestamp,
        triggeredByEmployeeId: changedByEmployeeId,
        triggeredByUserId,
        payload: { actionUrl: payload.actionUrl, oldStatus, newStatus },
        models,
    })
}