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

function applicablePolicyFilter(employee) {
  const audience = [
    { applicableTo: 'all' },
    { applicableTo: { $exists: false } },
  ]
  if (employee.department) {
    audience.push({ applicableTo: 'department', department: employee.department })
    audience.push({ applicableTo: 'department', departments: employee.department })
  }
  if (employee.company) audience.push({ applicableTo: 'company', companies: employee.company })
  audience.push({ applicableTo: 'specific', specificEmployees: employee._id })
  return {
    isActive: { $ne: false },
    requiresAcknowledgment: { $ne: false },
    $or: audience,
  }
}

export async function getOnboardingCompletionSignals({ models, employee }) {
  const employeeId = employee._id

  const [documentRecords, assignedAssetExists, processedPayrollExists, completedWorkflows, policies] = await Promise.all([
    models.Document.find({
          $or: [{ employee: employeeId }, { uploadedBy: employeeId }],
          isActive: { $ne: false },
        }).select('name type category fileName fileUrl url fileId').lean(),
    models.Asset.exists({ assignedTo: employeeId, status: 'assigned' }).then(Boolean),
    models.Payroll.exists({ employee: employeeId, status: { $in: ['processed', 'paid'] } }).then(Boolean),
    models.HrmsWorkflow.find({
      subjectEmployee: employeeId,
      module: { $in: ['backgroundVerification', 'departmentInduction'] },
      status: 'completed',
    }).select('module').lean(),
    models.Policy.find(applicablePolicyFilter(employee)).select('acknowledgments.employee').lean(),
  ])

  const completedModules = new Set(completedWorkflows.map((workflow) => workflow.module))
  const allDocuments = [
    ...(Array.isArray(employee.documents) ? employee.documents : []),
    ...(documentRecords || []),
  ].filter((document) => document?.url || document?.fileUrl)
  const hasIdentityProof = hasMatchingDocument(allDocuments, /identity|aadhaar|passport|voter|driv(?:er|ing)|onboarding_identity_proof/)
  const hasTaxDocument = hasMatchingDocument(allDocuments, /\btax\b|\bpan\b|onboarding_tax_document/)
  const hasEmploymentDocument = hasMatchingDocument(allDocuments, /employment|offer|appointment|contract|experience|onboarding_employment_document/)
  const hasBackgroundReport = hasMatchingDocument(allDocuments, /background|verification report|onboarding_background_report/)
  const hasBankProof = hasMatchingDocument(allDocuments, /bank proof|cancelled cheque|canceled check|onboarding_bank_proof/)
  const policiesAcknowledged = policies.every((policy) =>
    (policy.acknowledgments || []).some((acknowledgment) => String(acknowledgment.employee) === String(employeeId))
  )

  return {
    profile: hasCompleteProfile(employee),
    documents: hasIdentityProof && hasTaxDocument && hasEmploymentDocument,
    background_verification: completedModules.has('backgroundVerification') && hasBackgroundReport,
    payroll: hasCompleteBankDetails(employee) && (hasConfiguredSalary(employee) || processedPayrollExists) && hasBankProof,
    policies: policiesAcknowledged,
    induction: completedModules.has('departmentInduction'),
    assets: Boolean(assignedAssetExists),
  }
}
