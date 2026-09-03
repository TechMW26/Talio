export const ONBOARDING_VERIFICATION_REQUIREMENTS = Object.freeze({
  profile: {
    title: 'Verify employee profile',
    description: 'Confirm the employee contact and emergency contact information before completing this step.',
    fields: [
      { key: 'phone', label: 'Employee phone number', type: 'text', required: true },
      { key: 'emergencyContactName', label: 'Emergency contact name', type: 'text', required: true },
      { key: 'emergencyContactRelationship', label: 'Relationship', type: 'text', required: true },
      { key: 'emergencyContactPhone', label: 'Emergency contact phone', type: 'text', required: true },
    ],
    uploads: [],
  },
  documents: {
    title: 'Verify joining documents',
    description: 'Upload the required identity, tax, and employment documents. Each file is also added to the employee document register.',
    fields: [],
    uploads: [
      { key: 'identity_proof', label: 'Identity proof', required: true },
      { key: 'tax_document', label: 'Tax document', required: true },
      { key: 'employment_document', label: 'Employment document', required: true },
    ],
  },
  background_verification: {
    title: 'Verify background check',
    description: 'Record the completed verification and attach the provider report.',
    fields: [
      { key: 'provider', label: 'Verification provider', type: 'text', required: true },
      { key: 'referenceNumber', label: 'Verification reference', type: 'text', required: true },
      { key: 'completedOn', label: 'Completion date', type: 'date', required: true },
      { key: 'clearanceConfirmed', label: 'The background check is cleared', type: 'checkbox', required: true },
    ],
    uploads: [{ key: 'background_report', label: 'Background verification report', required: true }],
  },
  payroll: {
    title: 'Verify bank and payroll details',
    description: 'Confirm bank information, statutory readiness, and upload supporting bank proof.',
    fields: [
      { key: 'bankName', label: 'Bank name', type: 'text', required: true },
      { key: 'accountNumber', label: 'Account number', type: 'text', required: true },
      { key: 'ifscCode', label: 'IFSC code', type: 'text', required: true },
      { key: 'statutoryReference', label: 'Payroll or statutory reference', type: 'text', required: true },
      { key: 'statutoryConfirmed', label: 'Payroll and statutory details have been checked', type: 'checkbox', required: true },
    ],
    uploads: [{ key: 'bank_proof', label: 'Cancelled cheque or bank proof', required: true }],
  },
  policies: {
    title: 'Verify policy acknowledgement',
    description: 'Confirm that all applicable organisation policies were shared and acknowledged.',
    fields: [
      { key: 'acknowledgedOn', label: 'Acknowledgement date', type: 'date', required: true },
      { key: 'acknowledgmentReference', label: 'Acknowledgement reference', type: 'text', required: true },
      { key: 'acknowledgmentConfirmed', label: 'All applicable policies were acknowledged', type: 'checkbox', required: true },
    ],
    uploads: [],
  },
  induction: {
    title: 'Verify induction completion',
    description: 'Capture who conducted the induction and what was covered.',
    fields: [
      { key: 'completedOn', label: 'Induction date', type: 'date', required: true },
      { key: 'facilitator', label: 'Facilitator', type: 'text', required: true },
      { key: 'topicsCovered', label: 'Topics covered', type: 'textarea', required: true },
      { key: 'attendanceConfirmed', label: 'Employee attendance is confirmed', type: 'checkbox', required: true },
    ],
    uploads: [],
  },
  assets: {
    title: 'Verify equipment and access handover',
    description: 'Confirm equipment, application access, and the employee handover acknowledgement.',
    fields: [
      { key: 'handoverReference', label: 'Handover reference', type: 'text', required: true },
      { key: 'systemAccessConfirmed', label: 'Required system access has been issued', type: 'checkbox', required: true },
      { key: 'employeeAcknowledged', label: 'Employee acknowledged the handover', type: 'checkbox', required: true },
    ],
    uploads: [{ key: 'handover_acknowledgement', label: 'Signed handover acknowledgement', required: true }],
  },
})

const cleanText = (value, maxLength = 2000) => String(value || '').trim().slice(0, maxLength)

function normalizeDocument(document, requirement) {
  if (!document || document.requirementKey !== requirement.key) return null
  const fileName = cleanText(document.fileName, 255)
  const fileUrl = cleanText(document.fileUrl, 2000)
  const fileId = cleanText(document.fileId, 1000)
  const fileType = cleanText(document.fileType || 'application/octet-stream', 255)
  const fileSize = Number(document.fileSize || 0)
  if (!fileName || !fileUrl || !fileId || !Number.isFinite(fileSize) || fileSize <= 0) return null
  return {
    requirementKey: requirement.key,
    label: requirement.label,
    fileName,
    fileUrl,
    fileId,
    fileType,
    fileSize,
  }
}

export function getOnboardingVerificationRequirement(itemKey) {
  return ONBOARDING_VERIFICATION_REQUIREMENTS[itemKey] || null
}

export function normalizeOnboardingVerification(itemKey, input = {}, context = {}) {
  const requirement = getOnboardingVerificationRequirement(itemKey)
  if (!requirement) throw new Error('This onboarding step does not support manual verification')

  const inputDetails = input.details && typeof input.details === 'object' ? input.details : {}
  const details = {}
  for (const field of requirement.fields) {
    if (field.type === 'checkbox') {
      const checked = inputDetails[field.key] === true
      if (field.required && !checked) throw new Error(`${field.label} must be confirmed`)
      details[field.key] = checked
      continue
    }
    const value = cleanText(inputDetails[field.key])
    if (field.required && !value) throw new Error(`${field.label} is required`)
    if (field.type === 'date' && value && Number.isNaN(new Date(`${value}T12:00:00.000Z`).getTime())) {
      throw new Error(`${field.label} is invalid`)
    }
    details[field.key] = value
  }

  const inputDocuments = Array.isArray(input.documents) ? input.documents : []
  const documents = requirement.uploads.map((upload) => {
    const document = normalizeDocument(inputDocuments.find((entry) => entry?.requirementKey === upload.key), upload)
    if (upload.required && !document) throw new Error(`${upload.label} must be uploaded`)
    return document
  }).filter(Boolean)

  const remarks = cleanText(input.remarks)
  const verifiedAt = context.now instanceof Date ? context.now : new Date(context.now || Date.now())
  const persistedDetails = { ...details }
  if (itemKey === 'payroll' && persistedDetails.accountNumber) {
    persistedDetails.accountNumberLast4 = persistedDetails.accountNumber.slice(-4)
    delete persistedDetails.accountNumber
  }

  const employee = context.employee || {}
  const employeeUpdates = {}
  if (itemKey === 'profile') {
    employeeUpdates.phone = details.phone
    employeeUpdates.emergencyContact = {
      ...(employee.emergencyContact || {}),
      name: details.emergencyContactName,
      relationship: details.emergencyContactRelationship,
      phone: details.emergencyContactPhone,
    }
  }
  if (itemKey === 'payroll') {
    employeeUpdates.bankDetails = {
      ...(employee.bankDetails || {}),
      bankName: details.bankName,
      accountNumber: details.accountNumber,
      ifscCode: details.ifscCode.toUpperCase(),
    }
  }

  return {
    verification: {
      status: 'verified',
      method: 'manual',
      verifiedAt,
      verifiedBy: context.actorId || null,
      remarks,
      details: persistedDetails,
      documents,
    },
    employeeUpdates,
  }
}

export function createLinkedOnboardingVerification(itemKey, context = {}) {
  const verifiedAt = context.now instanceof Date ? context.now : new Date(context.now || Date.now())
  return {
    status: 'verified',
    method: 'linked_record',
    verifiedAt,
    verifiedBy: null,
    remarks: '',
    details: { signalKey: itemKey },
    documents: [],
  }
}
