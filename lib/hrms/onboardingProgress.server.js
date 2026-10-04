function hasText(value) {
  return Boolean(String(value || '').trim())
}

function hasCompleteProfile(employee) {
  return [employee.firstName, employee.lastName, employee.email, employee.phone, employee.dateOfJoining].every(Boolean)
    && hasText(employee.emergencyContact?.name)
    && hasText(employee.emergencyContact?.phone)
}

function hasCompleteBankDetails(employee) {
  return hasText(employee.bankDetails?.bankName)
    && hasText(employee.bankDetails?.accountNumber)
    && hasText(employee.bankDetails?.ifscCode)
}

function hasConfiguredSalary(employee) {
  const salary = employee.salary || {}
  return Number(salary.basic || salary.grossSalary || salary.ctc || salary.netSalary || 0) > 0
}

function documentSearchText(document = {}) {
  return [document.category, document.type, document.name, document.fileName, document.requirementKey]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function hasMatchingDocument(documents, pattern) {
  return documents.some((document) => pattern.test(documentSearchText(document)))
}

async function queryAll(database, collection, filters) {
  const records = []; let cursor
  do {
    const page = await database.list(collection, { filters, limit: 100, cursor })
    records.push(...page.records); cursor = page.nextCursor
  } while (cursor)
  return records
}

export async function getOnboardingCompletionSignals({ database, employee }) {
  const employeeId = String(employee._id)
  const policyScopes = [[{ field: 'applicableTo', operator: '==', value: 'all' }]]
  if (employee.department) {
    policyScopes.push([{ field: 'applicableTo', operator: '==', value: 'department' }, { field: 'department', operator: '==', value: String(employee.department) }])
    policyScopes.push([{ field: 'applicableTo', operator: '==', value: 'department' }, { field: 'departments', operator: 'array-contains', value: String(employee.department) }])
  }
  if (employee.company) policyScopes.push([{ field: 'applicableTo', operator: '==', value: 'company' }, { field: 'companies', operator: 'array-contains', value: String(employee.company) }])
  policyScopes.push([{ field: 'applicableTo', operator: '==', value: 'specific' }, { field: 'specificEmployees', operator: 'array-contains', value: employeeId }])
  const [documentsByEmployee, documentsByUploader, assignedAssets, processedPayroll, completedWorkflows, policyGroups] = await Promise.all([
    queryAll(database, 'documents', [{ field: 'employee', operator: '==', value: employeeId }]),
    queryAll(database, 'documents', [{ field: 'uploadedBy', operator: '==', value: employeeId }]),
    database.list('assets', { filters: [{ field: 'assignedTo', operator: '==', value: employeeId }, { field: 'status', operator: '==', value: 'assigned' }], limit: 1 }),
    database.list('payrolls', { filters: [{ field: 'employee', operator: '==', value: employeeId }, { field: 'status', operator: 'in', value: ['processed', 'paid'] }], limit: 1 }),
    queryAll(database, 'hrmsworkflows', [{ field: 'subjectEmployee', operator: '==', value: employeeId }, { field: 'module', operator: 'in', value: ['backgroundVerification', 'departmentInduction'] }, { field: 'status', operator: '==', value: 'completed' }]),
    Promise.all(policyScopes.map(filters => queryAll(database, 'policies', filters))),
  ])
  const documentRecords = [...new Map([...documentsByEmployee, ...documentsByUploader].map(document => [String(document._id), document])).values()].filter(document => document.isActive !== false && !['pending', 'changes_requested', 'rejected'].includes(document.status))
  const policies = [...new Map(policyGroups.flat().map(policy => [String(policy._id), policy])).values()].filter(policy => policy.isActive !== false && policy.requiresAcknowledgment !== false)
  const assignedAssetExists = assignedAssets.records.length > 0
  const processedPayrollExists = processedPayroll.records.length > 0

  const completedModules = new Set(completedWorkflows.map((workflow) => workflow.module))
  const allDocuments = [
    ...(Array.isArray(employee.documents) ? employee.documents : []),
    ...(documentRecords || []),
  ].filter((document) => (document?.url || document?.fileUrl) && !['pending', 'changes_requested', 'rejected'].includes(document.status))
  const mandatoryJoiningDocuments = [
    /aadhaar|aadhar/,
    /\bpan\b|permanent account/,
    /class[_\s-]*10|10th|tenth|secondary marksheet/,
    /class[_\s-]*12|12th|twelfth|senior secondary/,
    /graduation|degree|bachelor|master/,
    /police verification|police[_\s-]*verification/,
  ]
  const hasRequiredJoiningDocuments = mandatoryJoiningDocuments.every((pattern) => hasMatchingDocument(allDocuments, pattern))
  const hasBackgroundReport = hasMatchingDocument(allDocuments, /background|verification report|onboarding_background_report/)
  const hasBankProof = hasMatchingDocument(allDocuments, /bank proof|cancelled cheque|canceled check|onboarding_bank_proof/)
  const policiesAcknowledged = policies.every((policy) =>
    (policy.acknowledgments || []).some((acknowledgment) => String(acknowledgment.employee) === String(employeeId))
  )

  return {
    profile: hasCompleteProfile(employee),
    documents: hasRequiredJoiningDocuments,
    background_verification: completedModules.has('backgroundVerification') && hasBackgroundReport,
    payroll: hasCompleteBankDetails(employee) && (hasConfiguredSalary(employee) || processedPayrollExists) && hasBankProof,
    policies: policiesAcknowledged,
    induction: completedModules.has('departmentInduction'),
    assets: Boolean(assignedAssetExists),
  }
}
