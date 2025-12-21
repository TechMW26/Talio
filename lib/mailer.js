import nodemailer from 'nodemailer'
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
} from './emailTemplate'

let transporter = null

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

export async function sendEmail({ to, subject, text, html }) {
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

  // Build getting started section
  const gettingStartedSteps = `
    <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 12px 0;">
      <tr>
        <td style="padding: 8px 0;">
          <table role="presentation" style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="width: 28px; vertical-align: top;">
                <div style="width: 22px; height: 22px; background: #3b82f6; border-radius: 6px; text-align: center; line-height: 22px; font-weight: 600; font-size: 12px; color: #ffffff;">1</div>
              </td>
              <td style="vertical-align: top; padding-left: 10px;">
                <p style="margin: 0; font-size: 13px; color: #1e293b;"><strong>Download</strong> the Talio desktop app</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding: 8px 0;">
          <table role="presentation" style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="width: 28px; vertical-align: top;">
                <div style="width: 22px; height: 22px; background: #3b82f6; border-radius: 6px; text-align: center; line-height: 22px; font-weight: 600; font-size: 12px; color: #ffffff;">2</div>
              </td>
              <td style="vertical-align: top; padding-left: 10px;">
                <p style="margin: 0; font-size: 13px; color: #1e293b;"><strong>Install</strong> and launch the application</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding: 8px 0;">
          <table role="presentation" style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="width: 28px; vertical-align: top;">
                <div style="width: 22px; height: 22px; background: #3b82f6; border-radius: 6px; text-align: center; line-height: 22px; font-weight: 600; font-size: 12px; color: #ffffff;">3</div>
              </td>
              <td style="vertical-align: top; padding-left: 10px;">
                <p style="margin: 0; font-size: 13px; color: #1e293b;"><strong>Sign in</strong> with your credentials above</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `

  const content = `
    ${emailHeading(`Welcome, ${firstName}`, 'large')}
    ${emailParagraph('Your Talio account has been created. Here is everything you need to get started.')}
    ${employeeDetails}
    ${emailHeading('Your Credentials', 'small')}
    ${emailInfoBox(credentialsContent, 'success')}
    ${emailInfoBox('<strong>Important:</strong> Please change your password after your first login.', 'warning')}
    ${emailHeading('Getting Started', 'small')}
    ${gettingStartedSteps}
    <div style="text-align: center; margin: 16px 0;">
      ${emailButton('Download Talio App', 'https://app.talio.in/resources')}
    </div>
    <div style="text-align: center; margin: 8px 0;">
      ${emailButtonOutline('Login via Browser', 'https://app.talio.in/login')}
    </div>
    ${emailDivider()}
    ${emailParagraph('Need help? Contact your HR administrator.', true)}
    ${emailParagraph('Best regards,<br>Talio', true)}
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
 */
export async function sendAndLogOnboardingEmail({
  employeeId,
  userId,
  to,
  firstName,
  lastName,
  email,
  password,
  employeeCode,
  designation,
  department,
  dateOfJoining,
  triggeredBy = 'manual_creation',
  retriedBy = null,
  forceEnabled = false,
}) {
  // Dynamic import to avoid circular dependencies
  const { default: OnboardingEmail } = await import('@/models/OnboardingEmail')
  const { default: CompanySettings } = await import('@/models/CompanySettings')
  const { default: connectDB } = await import('@/lib/mongodb')
  
  await connectDB()
  
  // Check if onboarding emails are enabled (unless forced)
  if (!forceEnabled) {
    const settings = await CompanySettings.findOne().select('notifications.onboardingEmailsEnabled').lean()
    const isEnabled = settings?.notifications?.onboardingEmailsEnabled !== false // Default to true if not set
    
    if (!isEnabled) {
      console.log(`[Onboarding Email] Skipped - onboarding emails are disabled. Employee: ${firstName} ${lastName} (${email})`)
      return { 
        success: false, 
        skipped: true,
        error: 'Onboarding emails are disabled in company settings' 
      }
    }
  }
  
  const fullName = `${firstName}${lastName ? ' ' + lastName : ''}`
  
  // Create the email log entry
  const emailLog = new OnboardingEmail({
    employee: employeeId,
    user: userId,
    recipientEmail: to || email,
    recipientName: fullName,
    employeeCode,
    designation,
    department,
    dateOfJoining: dateOfJoining ? new Date(dateOfJoining) : null,
    passwordSent: password,
    status: 'pending',
    triggeredBy,
    retriedBy,
  })
  
  try {
    // Try to send the email
    const result = await sendOnboardingEmail({
      to: to || email,
      firstName,
      lastName,
      email: email || to,
      password,
      employeeCode,
      designation,
      department,
      dateOfJoining,
    })
    
    if (result.success) {
      emailLog.status = 'sent'
      emailLog.sentAt = new Date()
    } else {
      emailLog.status = 'failed'
      emailLog.errorMessage = result.error || 'Unknown error'
    }
    
    await emailLog.save()
    
    return {
      success: result.success,
      emailLogId: emailLog._id,
      error: result.error,
    }
  } catch (error) {
    // Save as failed if any error occurs
    emailLog.status = 'failed'
    emailLog.errorMessage = error.message || 'Unknown error'
    
    try {
      await emailLog.save()
    } catch (saveError) {
      console.error('[mailer] Failed to save email log:', saveError)
    }
    
    return {
      success: false,
      emailLogId: emailLog._id,
      error: error.message,
    }
  }
}

/**
 * Retry sending a failed onboarding email
 */
export async function retryOnboardingEmail(emailLogId, retriedByUserId = null) {
  const { default: OnboardingEmail } = await import('@/models/OnboardingEmail')
  const { default: connectDB } = await import('@/lib/mongodb')
  
  await connectDB()
  
  const emailLog = await OnboardingEmail.findById(emailLogId)
  
  if (!emailLog) {
    return { success: false, error: 'Email log not found' }
  }
  
  // Update retry info
  emailLog.retryCount += 1
  emailLog.lastRetryAt = new Date()
  emailLog.retriedBy = retriedByUserId
  emailLog.status = 'pending'
  emailLog.errorMessage = null
  
  try {
    const result = await sendOnboardingEmail({
      to: emailLog.recipientEmail,
      firstName: emailLog.recipientName.split(' ')[0],
      lastName: emailLog.recipientName.split(' ').slice(1).join(' '),
      email: emailLog.recipientEmail,
      password: emailLog.passwordSent,
      employeeCode: emailLog.employeeCode,
      designation: emailLog.designation,
      department: emailLog.department,
      dateOfJoining: emailLog.dateOfJoining,
    })
    
    if (result.success) {
      emailLog.status = 'sent'
      emailLog.sentAt = new Date()
    } else {
      emailLog.status = 'failed'
      emailLog.errorMessage = result.error || 'Unknown error'
    }
    
    await emailLog.save()
    
    return {
      success: result.success,
      emailLogId: emailLog._id,
      error: result.error,
    }
  } catch (error) {
    emailLog.status = 'failed'
    emailLog.errorMessage = error.message || 'Unknown error'
    await emailLog.save()
    
    return {
      success: false,
      emailLogId: emailLog._id,
      error: error.message,
    }
  }
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

  const html = wrapEmailTemplate(content, 'Password Reset')

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

  const html = wrapEmailTemplate(content, 'Password Changed')

  try {
    await sendEmail({ to, subject, text, html })
    console.log(`[mailer] Password changed email sent to ${to}`)
    return { success: true }
  } catch (error) {
    console.error(`[mailer] Failed to send password changed email to ${to}:`, error)
    return { success: false, error: error.message }
  }
}
