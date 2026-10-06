import { createHash, randomBytes } from 'node:crypto'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { WORKFLOW_QUERY_FIELDS } from './workflowStore.server'
import { recordDigest } from '../platform/firestoreCodec.cjs'
import { createWorkflow } from './workflowService.server'
import { getLifecycleProgress } from './employeeLifecycle.server'

export function getLifecycleDatabase(auth) {
  if (!auth?.success || !auth.user || !auth.tenant?.databaseName) throw new Error('Verified tenant required')
  return getFirestoreTenantDatabase(auth.tenant.databaseName, {
    queryFields: {
      users: ['employeeId'], documents: ['employee', 'uploadedBy', 'fileId'],
      assets: ['assignedTo', 'status'], payrolls: ['employee', 'status'],
      policies: ['applicableTo', 'department', 'departments', 'companies', 'specificEmployees'],
      hrmsworkflows: WORKFLOW_QUERY_FIELDS, hrmsworkflowevents: ['workflow', 'createdAt'],
      probationapprovals: ['employee', 'createdAt'],
    },
    constraints: { hrmsworkflows: [{ fields: ['idempotencyKey'], sparse: true }, { fields: ['caseNumber'] }] },
  })
}

/** Review evidence and employee lifecycle together, never partially approve files. */
export async function persistLifecycleReview(database, { employee, actor, result, action, body }) {
  const now = new Date(), expected = recordDigest(employee)
  return database.transaction(async tx => {
    const current = await tx.get('employees', String(employee._id))
    if (!current || recordDigest(current) !== expected) return null
    const documents = []
    const item = result.lifecycle.onboarding?.checklist?.find(entry => entry.key === body.itemKey)
    const approving = action === 'complete_onboarding_item' && body.completed !== false
    const requesting = action === 'request_onboarding_changes'
    const evidence = approving ? item?.verification?.documents || [] : requesting ? item?.submission?.verification?.documents || [] : []
    if (evidence.length > 40) throw new Error('Review at most 40 evidence documents at a time')
    for (const file of evidence) {
      const matches = await tx.list('documents', { filters: [{ field: 'employee', operator: '==', value: String(employee._id) }, { field: 'fileId', operator: '==', value: file.fileId }], limit: 2, requireComplete: true })
      if (matches.records.length > 1) throw new Error('Duplicate employee evidence requires reconciliation')
      const existing = matches.records[0]
      if (requesting && !existing) continue
      const record = existing ? { ...existing } : {
        _id: createHash('sha256').update(JSON.stringify([employee._id, file.fileId])).digest('hex').slice(0, 24),
        name: file.fileName, type: file.fileType, url: file.fileUrl, fileName: file.fileName, fileType: file.fileType, fileUrl: file.fileUrl,
        fileId: file.fileId, fileSize: file.fileSize, employee: employee._id, uploadedBy: actor.employeeId || employee._id,
        category: `onboarding_${file.requirementKey}`, isActive: true, createdAt: now,
      }
      documents.push({ existing, record: { ...record, status: approving ? 'approved' : 'changes_requested', ...(requesting ? { reviewReason: item.submission.reviewReason } : {}), updatedAt: now } })
    }
    const changed = { ...current, lifecycle: result.lifecycle, ...result.employeeUpdates, __v: Number(current.__v || 0) + 1, updatedAt: now }
    await tx.replace('employees', changed)
    for (const { existing, record } of documents) {
      if (existing) await tx.replace('documents', record)
      else await tx.create('documents', record)
    }
    return changed
  })
}

export async function syncLifecycleWorkflow(database, { actor, employee, lifecycle, moduleName, action, body }) {
  let workflow = (await database.list('hrmsworkflows', { filters: [{ field: 'subjectEmployee', operator: '==', value: String(employee._id) }, { field: 'module', operator: '==', value: moduleName }], orderBy: [{ field: 'createdAt', direction: 'desc' }], limit: 1 })).records[0]
  const data = moduleName === 'exitManagement' ? lifecycle.offboarding : moduleName === 'probation' ? lifecycle.probation : lifecycle.onboarding
  const dueAt = moduleName === 'exitManagement' ? lifecycle.offboarding.lastWorkingDate : moduleName === 'probation' ? lifecycle.probation.reviewDate : lifecycle.onboarding.targetDate
  if (!workflow) {
    const created = await createWorkflow({ database, actor, bypassPermission: true, allowIncompleteData: true, payload: {
      module: moduleName, title: `${moduleName === 'exitManagement' ? 'Offboarding' : moduleName === 'probation' ? 'Probation' : 'Onboarding'}: ${employee.firstName} ${employee.lastName}`,
      subjectEmployee: employee._id, dueAt, data, source: { entityType: 'Employee', entityId: employee._id }, idempotencyKey: `employee:${employee._id}:${moduleName}`,
    } })
    if (!created.success || !created.workflow) throw new Error(created.message || 'Workflow could not be created')
    workflow = created.workflow
  }
  const completed = action === 'confirm_probation' || action === 'complete_offboarding' || (action === 'complete_onboarding_item' && getLifecycleProgress(lifecycle).percentage === 100)
  await database.transaction(async tx => {
    const current = await tx.get('hrmsworkflows', String(workflow._id))
    if (!current) throw new Error('Workflow no longer exists')
    const now = new Date(), status = completed ? 'completed' : 'in_progress'
    await tx.replace('hrmsworkflows', { ...current, status, data, dueAt, completedAt: completed ? current.completedAt || now : null, updatedBy: actor.id || actor._id, version: Number(current.version || 0) + 1, updatedAt: now })
    await tx.create('hrmsworkflowevents', { _id: randomBytes(12).toString('hex'), workflow: current._id, module: moduleName, type: action, fromStatus: current.status, toStatus: status, actor: actor.id || actor._id, comment: String(body.reason || '').slice(0, 2000), metadata: { source: 'employee_profile', itemKey: body.itemKey || null, verificationMethod: body.verification ? 'manual' : null, evidenceDocumentCount: body.verification?.documents?.length || 0 }, createdAt: now, updatedAt: now })
  })
}
