import { randomBytes } from 'node:crypto'
import sharp from 'sharp'
import { uploadImage, deleteImage } from './mediaStorage'
import { collectFirestorePages, readFirestoreReferences } from './platform/firestoreQueries.server'

export const COMPANY_STORE_OPTIONS = { queryFields: { companies: ['isActive'] }, constraints: { companies: [{ fields: ['name'] }, { fields: ['code'], sparse: true }] } }
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const FIELDS = ['name', 'code', 'description', 'isActive', 'logo', 'email', 'phone', 'website', 'timezone', 'address', 'workingHours', 'geofence', 'breakTimings', 'payroll', 'notifications']
const STRINGS = ['name', 'code', 'description', 'logo', 'email', 'phone', 'website', 'timezone']
const object = value => Boolean(value && typeof value === 'object' && !Array.isArray(value))

function safeNested(value, depth = 0) {
  if (depth > 10) fail('Company settings are too deeply nested')
  if (Array.isArray(value)) return value.map(item => safeNested(item, depth + 1))
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (['__proto__', 'constructor', 'prototype', '_id'].includes(key) || key.startsWith('$') || key.includes('.')) fail('Invalid company field')
    return [key, safeNested(item, depth + 1)]
  }))
  return value
}

function normalizeCompany(input, existing) {
  if (!object(input)) fail('Company details must be an object')
  const fields = Object.fromEntries(FIELDS.filter(key => input[key] !== undefined).map(key => [key, safeNested(input[key])]))
  for (const key of STRINGS) {
    if (fields[key] !== undefined && fields[key] !== null && typeof fields[key] !== 'string') fail(`Invalid ${key}`)
    if (typeof fields[key] === 'string') fields[key] = fields[key].trim()
  }
  if (fields.code) fields.code = fields.code.toUpperCase()
  if ((!existing && (!fields.name || !fields.code)) || fields.name === '' || fields.code === '') fail('Company name and code are required')
  if (fields.isActive !== undefined && typeof fields.isActive !== 'boolean') fail('Invalid company status')
  for (const key of ['address', 'workingHours', 'geofence', 'breakTimings', 'payroll', 'notifications']) if (fields[key] !== undefined && !object(fields[key])) fail(`Invalid ${key}`)
  if (fields.timezone) {
    try { new Intl.DateTimeFormat('en', { timeZone: fields.timezone }) } catch { fail('Invalid timezone') }
  }
  if (fields.payroll?.paymentCycle && !['monthly', 'bi-weekly', 'weekly'].includes(fields.payroll.paymentCycle)) fail('Invalid payment cycle')
  if (fields.geofence?.maxAccuracyMeters !== undefined && (!Number.isFinite(fields.geofence.maxAccuracyMeters) || fields.geofence.maxAccuracyMeters < 10 || fields.geofence.maxAccuracyMeters > 5000)) fail('Geofence accuracy must be between 10 and 5000 metres')
  if (fields.logo && !fields.logo.startsWith('data:image/') && !/^https:\/\//.test(fields.logo) && !/^\/api\/(files|images)\//.test(fields.logo)) fail('Invalid company logo URL')
  const defaults = {
    description: '', logo: '', logoFileId: '', email: '', phone: '', website: '', timezone: 'Asia/Kolkata', isActive: true,
    address: { street: '', city: '', state: '', country: '', zipCode: '' },
    workingHours: { checkInTime: '09:00', checkOutTime: '18:00', lateThresholdMinutes: 15, absentThresholdMinutes: 60, halfDayHours: 4, fullDayHours: 8, workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] },
    geofence: { enabled: false, strictMode: false, notifyOnExit: true, requireApproval: true, useMultipleLocations: true, maxAccuracyMeters: 150 },
    breakTimings: { enabled: false, breaks: [] },
    payroll: { paymentDay: 1, paymentCycle: 'monthly', currency: 'INR', taxSettings: { enableTds: true, enablePf: true, enableEsi: false } },
    notifications: { emailNotifications: true, emailEvents: { login: true, attendance: true, leave: true }, onboardingEmailsEnabled: true },
  }
  return existing ? fields : { ...defaults, ...fields }
}

export async function populateCompanies(database, records) {
  const users = await readFirestoreReferences(database, 'users', records.map(record => record.createdBy))
  return records.map(record => ({ ...record, createdBy: users.has(String(record.createdBy)) ? { _id: record.createdBy, email: users.get(String(record.createdBy)).email } : null }))
}

export async function listCompanies(database) {
  const records = await collectFirestorePages(database, 'companies', { filters: [{ field: 'isActive', operator: '==', value: true }] })
  return populateCompanies(database, records.sort((a, b) => String(a.name).localeCompare(String(b.name))))
}

export async function saveCompany(database, actor, input, id) {
  if (!['admin', 'hr'].includes(actor.role)) fail('You do not have permission to update companies', 403)
  if (id && !/^[a-f\d]{24}$/i.test(id)) fail('Invalid company id')
  const existing = id ? await database.get('companies', id) : null
  if (id && !existing) fail('Company not found', 404)
  const fields = normalizeCompany(input, existing)
  const companyId = id || randomBytes(12).toString('hex')
  let uploaded
  try {
    if (fields.logo?.startsWith('data:image/')) {
      const match = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z\d+/=\r\n]+)$/.exec(fields.logo)
      if (!match || match[2].length > 14 * 1024 * 1024) fail('Choose a PNG, JPEG, WebP or GIF logo smaller than 10 MB')
      const bytes = Buffer.from(match[2], 'base64')
      if (!bytes.length || bytes.length > 10 * 1024 * 1024) fail('Choose a non-empty logo smaller than 10 MB')
      const normalized = await sharp(bytes, { limitInputPixels: 40000000 }).rotate().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 90 }).toBuffer()
      uploaded = await uploadImage(normalized, { databaseName: database.databaseName, category: 'company', companyId, userId: String(actor._id || actor.userId), contentType: 'image/webp', originalName: `company_${companyId}_logo.webp` })
      fields.logo = uploaded.url
      fields.logoFileId = String(uploaded._id)
    } else if (fields.logo !== undefined && fields.logo !== existing?.logo) {
      fields.logoFileId = /^\/api\/images\/([a-f\d]{24})$/i.exec(fields.logo || '')?.[1] || ''
    }
    const now = new Date()
    return await database.transaction(async tx => {
      if (id) {
        const current = await tx.get('companies', id)
        if (!current) fail('Company not found', 404)
        const next = { ...current, ...fields, updatedAt: now }
        await tx.replace('companies', next)
        return next
      }
      const next = { ...fields, _id: companyId, createdBy: String(actor._id || actor.userId), createdAt: now, updatedAt: now }
      await tx.create('companies', next)
      return next
    })
  } catch (error) {
    if (uploaded) await deleteImage(uploaded._id, { databaseName: database.databaseName }).catch(() => {})
    if (error.code === 'ALREADY_EXISTS') fail('Company with this name or code already exists')
    throw error
  }
  // Previous logo bytes are deliberately retained: a shared or concurrent
  // reference must never be deleted before the new company record commits.
}
