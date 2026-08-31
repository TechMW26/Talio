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
  const embeddedDocuments = Array.isArray(employee.documents) && employee.documents.some((document) => document?.url || document?.fileUrl)

  const [documentExists, assignedAssetExists, processedPayrollExists, completedWorkflows, policies] = await Promise.all([
    embeddedDocuments
      ? true
      : models.Document.exists({
          $or: [{ employee: employeeId }, { uploadedBy: employeeId }],
          isActive: { $ne: false },
        }).then(Boolean),
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
  const policiesAcknowledged = policies.every((policy) =>
    (policy.acknowledgments || []).some((acknowledgment) => String(acknowledgment.employee) === String(employeeId))
  )

  return {
    profile: hasCompleteProfile(employee),
    documents: Boolean(documentExists),
    background_verification: completedModules.has('backgroundVerification'),
    payroll: hasCompleteBankDetails(employee) && (hasConfiguredSalary(employee) || processedPayrollExists),
    policies: policiesAcknowledged,
    induction: completedModules.has('departmentInduction'),
    assets: Boolean(assignedAssetExists),
  }
}
