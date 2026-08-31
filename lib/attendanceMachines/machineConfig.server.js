import mongoose from 'mongoose'
import { encryptSecret } from '@/lib/secretEncryption'
import {
  ATTENDANCE_MACHINE_CONNECTION_MODES,
  getAttendanceMachineProvider,
  isSupportedConnectionMode,
} from './providerRegistry'

const ALLOWED_STATUS = new Set(['active', 'disabled'])

function cleanString(value, maxLength = 1000) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

export async function validateMachineInput(input, { Company, partial = false } = {}) {
  const errors = []
  const value = input && typeof input === 'object' ? input : {}
  const providerKey = cleanString(value.providerKey, 80).toLowerCase()
  const provider = providerKey ? getAttendanceMachineProvider(providerKey) : null
  const scope = cleanString(value.scope, 30) || 'organisation'
  const connectionMode = cleanString(value.connectionMode, 40)

  if (!partial || value.name !== undefined) {
    if (!cleanString(value.name, 120)) errors.push('Machine name is required')
  }
  if (!partial || value.providerKey !== undefined) {
    if (!provider) errors.push('Select a supported provider')
  }
  if (!partial || value.model !== undefined) {
    if (!cleanString(value.model, 160)) errors.push('Machine model is required')
  }
  if (!partial || value.scope !== undefined) {
    if (!['organisation', 'company'].includes(scope)) errors.push('Invalid machine scope')
  }
  if (!partial || value.connectionMode !== undefined) {
    if (!ATTENDANCE_MACHINE_CONNECTION_MODES[connectionMode]) {
      errors.push('Select a valid connection mode')
    } else if (provider && !isSupportedConnectionMode(providerKey, connectionMode)) {
      errors.push(`${provider.name} does not support the selected connection mode in Talio`)
    }
  }

  let company = null
  if (scope === 'company') {
    if (!mongoose.Types.ObjectId.isValid(value.companyId || '')) {
      errors.push('Select a company for a company-scoped machine')
    } else if (Company) {
      company = await Company.findOne({ _id: value.companyId, isActive: true }).select('_id name').lean()
      if (!company) errors.push('The selected company does not exist in this organisation')
    }
  }

  if (value.status !== undefined && !ALLOWED_STATUS.has(value.status)) {
    errors.push('Invalid machine status')
  }

  const duplicateWindowSeconds = Number(value.duplicateWindowSeconds ?? 30)
  if (!Number.isFinite(duplicateWindowSeconds) || duplicateWindowSeconds < 1 || duplicateWindowSeconds > 3600) {
    errors.push('Duplicate window must be between 1 and 3600 seconds')
  }
  if (value.port !== undefined && value.port !== '') {
    const port = Number(value.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('Port must be between 1 and 65535')
  }
  if (value.punchDirectionMode !== undefined && !['device', 'alternate', 'first_last'].includes(value.punchDirectionMode)) {
    errors.push('Invalid punch interpretation mode')
  }
  if (connectionMode === 'cloud_api' && value.endpointUrl) {
    try {
      const endpoint = new URL(value.endpointUrl)
      if (endpoint.protocol !== 'https:') errors.push('Vendor cloud endpoints must use HTTPS')
    } catch {
      errors.push('Vendor cloud endpoint must be a valid HTTPS URL')
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    company,
    provider,
    data: {
      ...(value.name !== undefined ? { name: cleanString(value.name, 120) } : {}),
      ...(provider ? { providerKey: provider.key, providerName: provider.name } : {}),
      ...(value.model !== undefined ? { model: cleanString(value.model, 160) } : {}),
      ...(value.serialNumber !== undefined ? { serialNumber: cleanString(value.serialNumber, 160) || null } : {}),
      scope,
      company: scope === 'company' ? company?._id || value.companyId : null,
      ...(value.locationName !== undefined ? { locationName: cleanString(value.locationName, 200) } : {}),
      timezone: 'Asia/Kolkata',
      ...(connectionMode ? { connectionMode } : {}),
      ...(value.endpointUrl !== undefined ? { endpointUrl: cleanString(value.endpointUrl, 2000) } : {}),
      ...(value.host !== undefined ? { host: cleanString(value.host, 255) } : {}),
      ...(value.port !== undefined && value.port !== '' ? { port: Number(value.port) } : {}),
      ...(value.siteId !== undefined ? { siteId: cleanString(value.siteId, 255) } : {}),
      duplicateWindowSeconds,
      ...(value.punchDirectionMode !== undefined ? { punchDirectionMode: value.punchDirectionMode } : {}),
      ...(value.employeeCodeField !== undefined ? { employeeCodeField: cleanString(value.employeeCodeField, 100) || 'employeeCode' } : {}),
      ...(value.status !== undefined ? { status: value.status } : {}),
    },
  }
}

export function buildEncryptedCredentials(input, currentConfigured = false) {
  const credentials = input?.credentials && typeof input.credentials === 'object' ? input.credentials : {}
  const update = {}
  let configured = currentConfigured

  for (const [plainKey, encryptedKey] of [
    ['username', 'usernameEncrypted'],
    ['password', 'passwordEncrypted'],
    ['apiKey', 'apiKeyEncrypted'],
  ]) {
    if (typeof credentials[plainKey] === 'string' && credentials[plainKey].trim()) {
      update[`credentials.${encryptedKey}`] = encryptSecret(credentials[plainKey].trim())
      configured = true
    }
  }

  return { update, credentialsConfigured: configured }
}

export function serializeMachine(machine, { companySlug, origin } = {}) {
  const value = typeof machine?.toObject === 'function' ? machine.toObject() : { ...machine }
  delete value.credentials
  delete value.webhookTokenHash

  const baseOrigin = String(origin || '').replace(/\/$/, '')
  const webhookPath = companySlug && value?._id
    ? `/api/attendance-machines/ingest/${encodeURIComponent(companySlug)}/${value._id}`
    : null

  return {
    ...value,
    webhookUrl: webhookPath ? `${baseOrigin}${webhookPath}` : null,
    connection: ATTENDANCE_MACHINE_CONNECTION_MODES[value.connectionMode] || null,
  }
}
