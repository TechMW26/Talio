import nodemailer from 'nodemailer'
import { randomBytes } from 'node:crypto'
import { encryptPassword, decryptPassword } from './passwordEncryption'
import { substringGrams } from './platform/searchProjection.cjs'
import {
  wrapEmailTemplate,
  emailButton,
  emailButtonOutline,
  emailInfoBox,
  emailDetailRow,
  emailDetailsTable,
  emailHeading,
  emailParagraph,
  emailDivider,
  emailCredentialBox,
} from './emailTemplate.js'

let transporter = null

// Rate limiting configuration
const EMAIL_RATE_LIMIT = {
  cooldownMinutes: 5,      // Base cooldown period after rate limit
  maxAutoRetries: 5,       // Maximum automatic retries
  backoffMultiplier: 2,    // Exponential backoff multiplier
}

/**
 * Calculate next retry time with exponential backoff
 */
function calculateNextRetryTime(retryCount) {
  const baseDelayMinutes = EMAIL_RATE_LIMIT.cooldownMinutes
  const backoffMinutes = baseDelayMinutes * Math.pow(EMAIL_RATE_LIMIT.backoffMultiplier, retryCount - 1)
  const maxDelayMinutes = 60 // Max 1 hour delay
  const delayMinutes = Math.min(backoffMinutes, maxDelayMinutes)

  return new Date(Date.now() + delayMinutes * 60 * 1000)
}

/**
 * Check if an error message indicates rate limiting
 */
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

function getTransporter() {
  if (transporter) return transporter

  const host = process.env.EMAIL_HOST
  const port = Number(process.env.EMAIL_PORT) || 465
  const secure = process.env.EMAIL_SECURE === 'true' || port === 465
  const user = process.env.EMAIL_USER
  const pass = process.env.EMAIL_PASSWORD

  if (!host || !user || !pass) {
    console.error(
      '[mailer] Missing email configuration. Please set EMAIL_HOST, EMAIL_PORT, EMAIL_USER and EMAIL_PASSWORD in your environment.'
    )
    return null
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
  })

  return transporter
}

export async function sendEmail({ to, subject, text, html, attachments }) {
  if (process.env.TALIO_LOCAL_ACCEPTANCE === '1') throw Object.assign(new Error('External email delivery is disabled during local acceptance'), { code: 'LOCAL_ACCEPTANCE_DELIVERY_DISABLED' })
  const activeTransporter = getTransporter()

  if (!activeTransporter) {
    console.error('[mailer] Transporter not initialized, email not sent.')
    throw new Error('Email transporter not initialized. Check EMAIL_HOST, EMAIL_USER, EMAIL_PASSWORD environment variables.')
  }

  const fromName =
    process.env.EMAIL_FROM_NAME || process.env.NEXT_PUBLIC_APP_NAME || 'Talio'
  const fromEmail = process.env.EMAIL_FROM_EMAIL || process.env.EMAIL_USER

  if (!fromEmail) {
    console.error('[mailer] EMAIL_FROM_EMAIL or EMAIL_USER is not set, email not sent.')
    throw new Error('EMAIL_FROM_EMAIL or EMAIL_USER is not configured.')
  }

  // Properly quote the from name to handle special characters
  const sanitizedFromName = fromName.replace(/"/g, '\\"')
  const from = fromName ? `"${sanitizedFromName}" <${fromEmail}>` : fromEmail

  console.log('[mailer] Sending email to:', to, 'subject:', subject)

  const mailOptions = {
    from,
    to,
    subject,
    text,
    html: html || (text ? `<p>${text.replace(/\n/g, '<br />')}</p>` : undefined),
  }

  if (Array.isArray(attachments) && attachments.length > 0) {
    mailOptions.attachments = attachments
  }

  const result = await activeTransporter.sendMail(mailOptions)
  console.log('[mailer] Email sent successfully. MessageId:', result.messageId)
  return result
}

export async function sendLoginAlertEmail({
  to,
  name,
  loginTime,
  userAgent,
  ipAddress,
}) {
  if (!to) {
    console.error('[mailer] Missing recipient email for login alert.')
    return
  }

  const time = loginTime || new Date()
  const timeString = time.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
  })

  const greetingName = name ? ` ${name}` : ''
  const subject = 'New Login Detected - Talio'

  const textLines = [
    `Hi${greetingName},`,
    '',
    `A new login to your Talio account was detected on ${timeString}.`,
  ]

  if (userAgent) {
    textLines.push(`Device: ${userAgent}`)
  }

  if (ipAddress) {
    textLines.push(`IP Address: ${ipAddress}`)
  }

  textLines.push(
    '',
    'If this was not you, please contact your administrator immediately.',
    '',
    'Best regards,',
    'Talio'
  )

  const text = textLines.join('\n')

  // Build content for template
  let detailRows = `
    <tr>
      <td style="padding: 6px 0; color: #64748b; font-size: 13px; width: 35%;">Time</td>
      <td style="padding: 6px 0; color: #1e293b; font-size: 13px; font-weight: 500;">${timeString}</td>
    </tr>
  `

  if (userAgent) {
    detailRows += `
    <tr>
      <td style="padding: 6px 0; color: #64748b; font-size: 13px;">Device</td>
      <td style="padding: 6px 0; color: #1e293b; font-size: 13px; font-weight: 500;">${userAgent}</td>
    </tr>`
  }

  if (ipAddress) {
    detailRows += `
    <tr>
      <td style="padding: 6px 0; color: #64748b; font-size: 13px;">IP Address</td>
      <td style="padding: 6px 0; color: #1e293b; font-size: 13px; font-weight: 500; font-family: monospace;">${ipAddress}</td>
    </tr>`
  }

  const content = `
    ${emailParagraph(`Hi${greetingName},`)}
    ${emailParagraph('A new login to your Talio account was detected.')}
    ${emailDetailsTable(detailRows)}
    ${emailInfoBox('<strong>Not you?</strong> If you did not initiate this login, please contact your administrator immediately.', 'warning')}
    ${emailParagraph('Best regards,<br>Talio', true)}
  `

  const html = wrapEmailTemplate({
    title: 'Login Alert',
    preheader: `New login detected on ${timeString}`,
    content,
    accentColor: '#f59e0b'
  })

  await sendEmail({ to, subject, text, html })
}

// Meeting invitation email
export async function sendMeetingInviteEmail({
  to,
  inviteeName,
  organizerName,
  meetingTitle,
  meetingType,
  startTime,
  endTime,
  location,
  description,
  meetingLink,
  respondLink,
}) {
  if (!to) {
    console.error('[mailer] Missing recipient email for meeting invite.')
    return
  }

  const startDate = new Date(startTime)
  const endDate = new Date(endTime)

  const dateString = startDate.toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Kolkata',
  })

  const timeRange = `${startDate.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  })} - ${endDate.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  })}`

  const greetingName = inviteeName ? ` ${inviteeName}` : ''
  const typeLabel = meetingType === 'online' ? 'Online Meeting' : 'In-Person Meeting'

  const subject = `Meeting Invitation: ${meetingTitle}`

  const textLines = [
    `Hi${greetingName},`,
    '',
    `You have been invited to a meeting by ${organizerName}.`,
    '',
    `Meeting Details:`,
    `Title: ${meetingTitle}`,
    `Type: ${typeLabel}`,
    `Date: ${dateString}`,
    `Time: ${timeRange}`,
  ]

  if (location) {
    textLines.push(`Location: ${location}`)
  }

  if (description) {
    textLines.push('', `Description: ${description}`)
  }

  if (meetingLink && meetingType === 'online') {
    textLines.push('', `Join Meeting: ${meetingLink}`)
  }

  textLines.push(
    '',
    `Please respond to this invitation: ${respondLink}`,
    '',
    'Best regards,',
    'Talio'
  )

  const text = textLines.join('\n')

  let detailRows = `
    ${emailDetailRow('Title', `<strong>${meetingTitle}</strong>`)}
    ${emailDetailRow('Type', typeLabel)}
    ${emailDetailRow('Date', dateString)}
    ${emailDetailRow('Time', timeRange)}
  `

  if (location) {
    detailRows += emailDetailRow('Location', location)
  }

  if (description) {
    detailRows += emailDetailRow('Description', description)
  }

  let buttons = ''
  if (meetingLink && meetingType === 'online') {
    buttons += `<div style="margin-bottom: 8px;">${emailButton('Join Meeting', meetingLink)}</div>`
  }
  buttons += emailButtonOutline('Respond to Invitation', respondLink, '#16a34a')

  const content = `
    ${emailParagraph(`Hi${greetingName},`)}
    ${emailParagraph(`You have been invited to a meeting by <strong>${organizerName}</strong>.`)}
    ${emailDetailsTable(detailRows)}
    <div style="text-align: center; margin: 16px 0;">
      ${buttons}
    </div>
    ${emailParagraph('Best regards,<br>Talio', true)}
  `

  const html = wrapEmailTemplate({
    title: 'Meeting Invitation',
    preheader: `Meeting: ${meetingTitle} on ${dateString}`,
    content
  })

  await sendEmail({ to, subject, text, html })
}

// Meeting response confirmation email (sent to organizer)
export async function sendMeetingResponseEmail({
  to,
  organizerName,
  inviteeName,
  meetingTitle,
  response,
  reason,
}) {
  if (!to) {
    console.error('[mailer] Missing recipient email for meeting response.')
    return
  }

  const responseText = response === 'accepted' ? 'Accepted' : 'Declined'
  const responseColor = response === 'accepted' ? '#16a34a' : '#dc2626'

  const subject = `Meeting Response: ${inviteeName} ${responseText} - ${meetingTitle}`

  const textLines = [
    `Hi ${organizerName},`,
    '',
    `${inviteeName} has ${responseText.toLowerCase()} your meeting invitation.`,
    '',
    `Meeting: ${meetingTitle}`,
  ]

  if (reason && response === 'rejected') {
    textLines.push(`Reason: ${reason}`)
  }

  textLines.push('', 'Best regards,', 'Talio')

  const text = textLines.join('\n')

  let detailRows = emailDetailRow('Meeting', meetingTitle)
  detailRows += emailDetailRow('Response', `<span style="color: ${responseColor}; font-weight: 600;">${responseText}</span>`)

  if (reason && response === 'rejected') {
    detailRows += emailDetailRow('Reason', reason)
  }

  const content = `
    ${emailParagraph(`Hi ${organizerName},`)}
    ${emailParagraph(`<strong>${inviteeName}</strong> has responded to your meeting invitation.`)}
    ${emailDetailsTable(detailRows)}
    ${emailParagraph('Best regards,<br>Talio', true)}
  `

  const html = wrapEmailTemplate({
    title: 'Meeting Response',
    preheader: `${inviteeName} ${responseText.toLowerCase()} your meeting`,
    content,
    accentColor: responseColor
  })

  await sendEmail({ to, subject, text, html })
}

// Meeting reminder email
export async function sendMeetingReminderEmail({
  to,
  inviteeName,
  meetingTitle,
  startTime,
  meetingType,
  location,
  meetingLink,
  minutesUntilStart,
}) {
  if (!to) {
    console.error('[mailer] Missing recipient email for meeting reminder.')
    return
  }

  const startDate = new Date(startTime)
  const timeString = startDate.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  })

  const greetingName = inviteeName ? ` ${inviteeName}` : ''
  const typeLabel = meetingType === 'online' ? 'Online' : 'In-Person'

  const subject = `Reminder: ${meetingTitle} starts in ${minutesUntilStart} minutes`

  const textLines = [
    `Hi${greetingName},`,
    '',
    `Reminder: Your meeting "${meetingTitle}" starts in ${minutesUntilStart} minutes at ${timeString}.`,
    '',
    `Type: ${typeLabel}`,
  ]

  if (location) {
    textLines.push(`Location: ${location}`)
  }

  if (meetingLink && meetingType === 'online') {
    textLines.push('', `Join here: ${meetingLink}`)
  }

  textLines.push('', 'Best regards,', 'Talio')

  const text = textLines.join('\n')

  let detailRows = `
    ${emailDetailRow('Meeting', `<strong>${meetingTitle}</strong>`)}
    ${emailDetailRow('Starts at', timeString)}
    ${emailDetailRow('Type', typeLabel)}
  `

  if (location) {
    detailRows += emailDetailRow('Location', location)
  }

  const content = `
    ${emailParagraph(`Hi${greetingName},`)}
    ${emailInfoBox(`<strong>Starting in ${minutesUntilStart} minutes</strong><br>Your meeting is about to begin.`, 'warning')}
    ${emailDetailsTable(detailRows)}
    ${meetingLink && meetingType === 'online' ? `<div style="text-align: center; margin: 16px 0;">${emailButton('Join Meeting Now', meetingLink)}</div>` : ''}
    ${emailParagraph('Best regards,<br>Talio', true)}
  `

  const html = wrapEmailTemplate({
    title: 'Meeting Reminder',
    preheader: `${meetingTitle} starts in ${minutesUntilStart} minutes`,
    content,
    accentColor: '#f59e0b'
  })

  await sendEmail({ to, subject, text, html })
}

// Meeting cancellation email
export async function sendMeetingCancellationEmail({
  to,
  inviteeName,
  organizerName,
  meetingTitle,
  originalStartTime,
  reason,
}) {
  if (!to) {
    console.error('[mailer] Missing recipient email for meeting cancellation.')
    return
  }

  const startDate = new Date(originalStartTime)
  const dateTimeString = startDate.toLocaleString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  })

  const greetingName = inviteeName ? ` ${inviteeName}` : ''

  const subject = `Meeting Cancelled: ${meetingTitle}`

  const textLines = [
    `Hi${greetingName},`,
    '',
    `The following meeting has been cancelled by ${organizerName}:`,
    '',
    `Meeting: ${meetingTitle}`,
    `Originally scheduled for: ${dateTimeString}`,
  ]

  if (reason) {
    textLines.push(`Reason: ${reason}`)
  }

  textLines.push('', 'Best regards,', 'Talio')

  const text = textLines.join('\n')

  let detailRows = `
    ${emailDetailRow('Meeting', `<strong>${meetingTitle}</strong>`)}
    ${emailDetailRow('Was scheduled for', dateTimeString)}
    ${emailDetailRow('Cancelled by', organizerName)}
  `

  if (reason) {
    detailRows += emailDetailRow('Reason', reason)
  }

  const content = `
    ${emailParagraph(`Hi${greetingName},`)}
    ${emailInfoBox('<strong>This meeting has been cancelled.</strong>', 'error')}
    ${emailDetailsTable(detailRows)}
    ${emailParagraph('If you have any questions, please contact the organizer directly.', true)}
    ${emailParagraph('Best regards,<br>Talio', true)}
  `

  const html = wrapEmailTemplate({
    title: 'Meeting Cancelled',
    preheader: `${meetingTitle} has been cancelled`,
    content,
    accentColor: '#dc2626'
  })

  await sendEmail({ to, subject, text, html })
}

// Meeting MOM email
export async function sendMeetingMOMEmail({
  to,
  inviteeName,
  meetingTitle,
  mom,
  aiSummary,
  meetingLink,
}) {
  if (!to) {
    console.error('[mailer] Missing recipient email for meeting MOM.')
    return
  }

  const greetingName = inviteeName ? ` ${inviteeName}` : ''

  const subject = `Meeting Minutes: ${meetingTitle}`

  const textLines = [
    `Hi${greetingName},`,
    '',
    `Here are the minutes of meeting for "${meetingTitle}":`,
    '',
    '--- Meeting Minutes ---',
    mom,
  ]

  if (aiSummary) {
    textLines.push('', '--- AI Summary ---', aiSummary)
  }

  if (meetingLink) {
    textLines.push('', `View full meeting details: ${meetingLink}`)
  }

  textLines.push('', 'Best regards,', 'Talio')

  const text = textLines.join('\n')

  let contentParts = `
    ${emailParagraph(`Hi${greetingName},`)}
    ${emailParagraph(`Here are the minutes for <strong>${meetingTitle}</strong>.`)}
    ${emailHeading('Meeting Minutes', 'small')}
    ${emailInfoBox(`<div style="white-space: pre-wrap; font-size: 13px;">${mom}</div>`, 'default')}
  `

  if (aiSummary) {
    contentParts += `
      ${emailHeading('AI Summary', 'small')}
      ${emailInfoBox(`<div style="white-space: pre-wrap; font-size: 13px;">${aiSummary}</div>`, 'info')}
    `
  }

  if (meetingLink) {
    contentParts += `<div style="text-align: center; margin: 16px 0;">${emailButton('View Meeting Details', meetingLink)}</div>`
  }

  contentParts += emailParagraph('Best regards,<br>Talio', true)

  const html = wrapEmailTemplate({
    title: 'Meeting Minutes',
    preheader: `Minutes for ${meetingTitle}`,
    content: contentParts
  })

  await sendEmail({ to, subject, text, html })
}

/**
 * Send onboarding welcome email to new employees
 * Includes login credentials and download link for desktop app
 */
export async function sendOnboardingEmail({
  to,
  firstName,
  lastName,
  email,
  password,
  employeeCode,
  designation,
  department,
  dateOfJoining,
}) {
  if (!to) {
    console.error('[mailer] Missing recipient email for onboarding.')
    return { success: false, error: 'Missing recipient email' }
  }

  const joiningDate = dateOfJoining
    ? new Date(dateOfJoining).toLocaleDateString('en-IN', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    : null

  const subject = `Welcome to Talio, ${firstName}`

  // Plain text version
  const textLines = [
    `Hi ${firstName},`,
    '',
    `Welcome to the team. Your Talio account has been created.`,
    '',
    `Login Credentials:`,
    `Email: ${email}`,
    `Password: ${password}`,
    '',
    `Please change your password after your first login.`,
    '',
    `Getting Started:`,
    `1. Download the Talio desktop app: https://app.talio.in/resources`,
    `2. Install and launch the app`,
    `3. Log in with your credentials`,
    '',
    `Login URL: https://app.talio.in/login`,
    '',
    `Need help? Contact your HR administrator.`,
    '',
    `Best regards,`,
    'Talio'
  ]

  const text = textLines.join('\n')

  // Build employee details section
  let employeeDetails = ''
  if (designation || department || joiningDate || employeeCode) {
    let detailRows = ''
    if (designation) detailRows += emailDetailRow('Role', designation)
    if (department) detailRows += emailDetailRow('Department', department)
    if (joiningDate) detailRows += emailDetailRow('Start Date', joiningDate)
    if (employeeCode) detailRows += emailDetailRow('Employee ID', `<span style="color: #3b82f6;">${employeeCode}</span>`)
    employeeDetails = emailDetailsTable(detailRows)
  }

  // Build credentials section
  const credentialsContent = `
    ${emailCredentialBox('Email', email)}
    ${emailCredentialBox('Temporary Password', password, true)}
  `

  const content = `
    ${emailHeading(`Welcome, ${firstName}`, 'large')}
    ${emailParagraph('Your Talio account has been created. Here is everything you need to get started.')}
    ${employeeDetails}
    ${emailHeading('Your Credentials', 'small')}
    ${emailInfoBox(credentialsContent, 'success')}
    ${emailInfoBox('<strong>Important:</strong> Please change your password after your first login.', 'warning')}
    ${emailHeading('Get Started', 'small')}
    ${emailParagraph('Download and install the Talio app, then sign in with your credentials above.')}
    <div style="text-align: center; margin: 16px 0;">
      ${emailButton('Download Talio App', 'https://app.talio.in/resources')}
    </div>
    <div style="text-align: center; margin: 8px 0;">
      ${emailButtonOutline('Login via Browser', 'https://app.talio.in/login')}
    </div>
    ${emailParagraph('Need help? Contact your HR administrator.', true)}
    <!-- ${Date.now()} -->
  `

  const html = wrapEmailTemplate({
    title: 'Welcome to Talio',
    preheader: `Welcome ${firstName}, your account is ready`,
    content,
    accentColor: '#16a34a'
  })

  try {
    await sendEmail({ to, subject, text, html })
    console.log(`[mailer] Onboarding email sent to ${to}`)
    return { success: true }
  } catch (error) {
    console.error(`[mailer] Failed to send onboarding email to ${to}:`, error)
    return { success: false, error: error.message }
  }
}

/**
 * Send onboarding email and log to database
 * This is the main function to use for tracking email history
 *
 * @param {boolean} forceEnabled - If true, bypasses the onboardingEmailsEnabled check (for manual retries)
/**
 * Send onboarding email and log it to the database
 * MULTI-TENANT: Pass models parameter with { OnboardingEmail, CompanySettings } for tenant-aware operations
 */
export async function sendAndLogOnboardingEmail(input) {
  const { database, forceEnabled = false } = input
  if (!database?.create || !database?.mutate) throw new Error('A native tenant database is required for onboarding email')
  if (!forceEnabled) {
    const settings = (await database.list('companysettings', { limit: 1 })).records[0]
    if (settings?.notifications?.onboardingEmailsEnabled === false) return { success: false, skipped: true, error: 'Onboarding emails are disabled in company settings' }
  }
  const allowedTriggers = ['manual_creation', 'bulk_import', 'manual_retry', 'manual_script']
  const now = new Date()
  const record = {
    _id: randomBytes(12).toString('hex'), employee: input.employeeId || null, user: input.userId || null,
    recipientEmail: String(input.to || input.email || '').trim().toLowerCase(),
    recipientName: [input.firstName, input.lastName].filter(Boolean).join(' '),
    employeeCode: input.employeeCode || '', designation: input.designation || '', department: input.department || '',
    dateOfJoining: input.dateOfJoining ? new Date(input.dateOfJoining) : null,
    encryptedPasswordSent: encryptPassword(input.password), status: 'pending',
    triggeredBy: allowedTriggers.includes(input.triggeredBy) ? input.triggeredBy : 'manual_creation',
    retriedBy: input.retriedBy || null, retryCount: 0, autoRetryCount: 0, queued: input.queueOnly === true,
    scheduledFor: input.queueOnly === true ? now : null, createdAt: now, updatedAt: now,
  }
  if (!record.recipientEmail || !record.recipientName || !record.encryptedPasswordSent) throw new Error('Recipient and onboarding credentials are required')
  record.searchGrams = substringGrams([record.recipientEmail, record.recipientName, record.employeeCode])
  // Persist intent before any provider call. No email runs in a retrying transaction.
  await database.create('onboardingemails', record)
  if (input.queueOnly === true || process.env.TALIO_LOCAL_ACCEPTANCE === '1') {
    if (!record.queued) await database.mutate('onboardingemails', record._id, current => ({ ...current, queued: true, scheduledFor: now }))
    return { success: true, queued: true, emailLogId: record._id, scheduledFor: now }
  }
  return deliverOnboardingLog(database, record._id, input.retriedBy, false)
}

async function deliverOnboardingLog(database, id, retriedBy, retry, onlyQueued = false) {
  if (process.env.TALIO_LOCAL_ACCEPTANCE === '1') return { success: false, skipped: true, queued: true, error: 'External email delivery is disabled during local acceptance' }
  const deliveryToken = randomBytes(12).toString('hex')
  let log
  try {
    log = await database.mutate('onboardingemails', String(id), current => {
      if (!current) return null
      if (onlyQueued && (!current.queued || current.status !== 'pending' || !current.scheduledFor || new Date(current.scheduledFor) > new Date())) throw Object.assign(new Error('Email is no longer due for delivery'), { code: 'DELIVERY_SKIPPED' })
      if (current.deliveryLeaseUntil && new Date(current.deliveryLeaseUntil).getTime() > Date.now()) throw Object.assign(new Error('Email is already being processed'), { code: 'DELIVERY_BUSY' })
      return { ...current, deliveryToken, deliveryLeaseUntil: new Date(Date.now() + 5 * 60000),
        status: 'pending', queued: false, scheduledFor: null, errorMessage: null, updatedAt: new Date(),
        ...(retry ? { retryCount: (current.retryCount || 0) + 1, lastRetryAt: new Date(), retriedBy: retriedBy || null } : {}),
      }
    })
  } catch (error) {
    if (error.code === 'DELIVERY_BUSY') return { success: false, busy: true, error: error.message }
    if (error.code === 'DELIVERY_SKIPPED') return { success: false, skipped: true, error: error.message }
    throw error
  }
  if (!log) return { success: false, error: 'Email log not found' }
  let result
  try {
    const password = log.encryptedPasswordSent ? decryptPassword(log.encryptedPasswordSent) : log.passwordSent
    if (!password) throw new Error('Onboarding credentials are unavailable; reset the password before retrying')
    result = await sendOnboardingEmail({
      to: log.recipientEmail, firstName: log.recipientName.split(' ')[0], lastName: log.recipientName.split(' ').slice(1).join(' '),
      email: log.recipientEmail, password, employeeCode: log.employeeCode, designation: log.designation,
      department: log.department, dateOfJoining: log.dateOfJoining,
    })
  } catch (error) { result = { success: false, error: error.message || 'Delivery failed' } }
  const rateLimited = !result.success && isRateLimitError(result.error)
  const saved = await database.mutate('onboardingemails', String(id), current => {
    if (current.deliveryToken !== deliveryToken) throw new Error('Email delivery lease was replaced; outcome requires review')
    const attempts = (current.autoRetryCount || 0) + (rateLimited ? 1 : 0)
    const queued = rateLimited && attempts < EMAIL_RATE_LIMIT.maxAutoRetries
    const scheduledFor = queued ? calculateNextRetryTime(attempts) : null
    return { ...current, status: result.success ? 'sent' : queued ? 'pending' : 'failed',
      ...(result.success ? { sentAt: new Date() } : {}),
      errorMessage: result.success ? null : result.error || 'Delivery failed', queued, scheduledFor,
      rateLimitedUntil: scheduledFor, autoRetryCount: attempts, deliveryToken: null, deliveryLeaseUntil: null, updatedAt: new Date(),
    }
  })
  return { success: result.success, emailLogId: saved._id, error: result.error,
    ...(saved.queued ? { rateLimited: true, scheduledFor: saved.scheduledFor } : {}),
  }
}

export async function retryOnboardingEmail(emailLogId, retriedByUserId = null, database, { onlyQueued = false } = {}) {
  if (!database?.mutate) throw new Error('A native tenant database is required for onboarding retry')
  return deliverOnboardingLog(database, emailLogId, retriedByUserId, true, onlyQueued)
}

/**
 * Send password reset email with secure link
 */
export async function sendPasswordResetEmail({
  to,
  firstName,
  resetLink,
  expiresInMinutes = 15,
}) {
  if (!to) {
    console.error('[mailer] Missing recipient email for password reset.')
    return { success: false, error: 'Missing recipient email' }
  }

  const subject = 'Reset Your Talio Password'

  // Plain text version
  const textLines = [
    `Hi ${firstName || 'there'},`,
    '',
    `We received a request to reset your Talio password.`,
    '',
    `Click the link below to reset your password:`,
    resetLink,
    '',
    `This link will expire in ${expiresInMinutes} minutes.`,
    '',
    `If you didn't request this, please ignore this email or contact your administrator if you have concerns.`,
    '',
    `Thanks,`,
    'Talio Team'
  ]

  const text = textLines.join('\n')

  const content = `
    ${emailHeading('Reset Your Password')}
    ${emailParagraph(`Hi ${firstName || 'there'}, we received a request to reset your password.`)}
    ${emailInfoBox(`This link expires in ${expiresInMinutes} minutes. For security reasons, password reset links are time-limited.`, 'warning')}
    <div style="text-align: center; padding: 16px 0;">
      ${emailButton('Reset Password', resetLink)}
    </div>
    ${emailParagraph('Or copy and paste this link in your browser:', 'center')}
    <p style="margin: 0 0 16px 0; font-size: 12px; color: #3b82f6; word-break: break-all; text-align: center; background: #f8fafc; padding: 10px; border-radius: 8px; border: 1px solid #e2e8f0;">
      ${resetLink}
    </p>
    ${emailInfoBox(`<strong>Didn't request this?</strong><br>If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.`)}
  `

  const html = wrapEmailTemplate({
    title: 'Password Reset',
    content,
    accentColor: '#3b82f6'
  })

  try {
    await sendEmail({ to, subject, text, html })
    console.log(`[mailer] Password reset email sent to ${to}`)
    return { success: true }
  } catch (error) {
    console.error(`[mailer] Failed to send password reset email to ${to}:`, error)
    return { success: false, error: error.message }
  }
}

/**
 * Send password changed confirmation email
 */
export async function sendPasswordChangedEmail({
  to,
  firstName,
  changedAt,
  ipAddress,
  userAgent,
}) {
  if (!to) {
    console.error('[mailer] Missing recipient email for password changed notification.')
    return { success: false, error: 'Missing recipient email' }
  }

  const timeString = (changedAt || new Date()).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'full',
    timeStyle: 'short',
  })

  const subject = 'Your Talio Password Was Changed'

  // Plain text version
  const textLines = [
    `Hi ${firstName || 'there'},`,
    '',
    `Your Talio password was successfully changed on ${timeString}.`,
    '',
    ipAddress ? `IP Address: ${ipAddress}` : '',
    '',
    `If you made this change, you can safely ignore this email.`,
    '',
    `If you didn't change your password, please contact your administrator immediately.`,
    '',
    `Thanks,`,
    'Talio Team'
  ].filter(Boolean)

  const text = textLines.join('\n')

  const detailRows = [
    emailDetailRow('Changed on', timeString),
    ipAddress ? emailDetailRow('IP Address', `<code style="font-family: monospace;">${ipAddress}</code>`) : '',
  ].filter(Boolean).join('')

  const content = `
    ${emailHeading('Password Changed Successfully')}
    ${emailParagraph(`Hi ${firstName || 'there'}, your Talio password was changed.`)}
    ${emailDetailsTable(detailRows, 'success')}
    ${emailInfoBox(`<strong>Didn't make this change?</strong><br>If you didn't change your password, please contact your administrator immediately as your account may be compromised.`, 'error')}
  `

  const html = wrapEmailTemplate({
    title: 'Password Changed',
    content,
    accentColor: '#3b82f6'
  })

  try {
    await sendEmail({ to, subject, text, html })
    console.log(`[mailer] Password changed email sent to ${to}`)
    return { success: true }
  } catch (error) {
    console.error(`[mailer] Failed to send password changed email to ${to}:`, error)
    return { success: false, error: error.message }
  }
}
