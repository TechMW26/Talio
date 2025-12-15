import nodemailer from 'nodemailer'

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
    return
  }

  const fromName =
    process.env.EMAIL_FROM_NAME || process.env.NEXT_PUBLIC_APP_NAME || 'Talio HRMS'
  const fromEmail = process.env.EMAIL_FROM_EMAIL || process.env.EMAIL_USER

  if (!fromEmail) {
    console.error('[mailer] EMAIL_FROM_EMAIL or EMAIL_USER is not set, email not sent.')
    return
  }

  const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail

  const mailOptions = {
    from,
    to,
    subject,
    text,
    html: html || (text ? `<p>${text.replace(/\n/g, '<br />')}</p>` : undefined),
  }

  await activeTransporter.sendMail(mailOptions)
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

  const time =
    loginTime || new Date()

  const timeString = time.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
  })

  const greetingName = name ? ` ${name}` : ''

  const subject = 'New login to Talio HRMS'

  const textLines = [
    `Hi${greetingName},`,
    '',
    `You just logged in to Talio HRMS on ${timeString}.`,
  ]

  if (userAgent) {
    textLines.push(`Device: ${userAgent}`)
  }

  if (ipAddress) {
    textLines.push(`IP Address: ${ipAddress}`)
  }

  textLines.push(
    '',
    'If this was not you, please contact your HR/administrator immediately.',
    '',
    'Thanks,',
    'Talio HRMS'
  )

  const text = textLines.join('\n')

  const htmlParts = [
    `<p>Hi${greetingName},</p>`,
    `<p>You just logged in to <strong>Talio HRMS</strong> on ${timeString}.</p>`,
  ]

  if (userAgent) {
    htmlParts.push(`<p><strong>Device:</strong> ${userAgent}</p>`)
  }

  if (ipAddress) {
    htmlParts.push(`<p><strong>IP Address:</strong> ${ipAddress}</p>`)
  }

  htmlParts.push(
    '<p>If this was not you, please contact your HR/administrator immediately.</p>',
    '<p>Thanks,<br/>Talio HRMS</p>'
  )

  const html = htmlParts.join('\n')

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
  const typeLabel = meetingType === 'online' ? '📹 Online Meeting' : '📍 Offline Meeting'

  const subject = `Meeting Invitation: ${meetingTitle}`

  const textLines = [
    `Hi${greetingName},`,
    '',
    `You have been invited to a meeting by ${organizerName}.`,
    '',
    `📌 Meeting Details:`,
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
    'Thanks,',
    'Talio HRMS'
  )

  const text = textLines.join('\n')

  const htmlParts = [
    `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">`,
    `<p>Hi${greetingName},</p>`,
    `<p>You have been invited to a meeting by <strong>${organizerName}</strong>.</p>`,
    `<div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">`,
    `<h3 style="margin-top: 0; color: #4f46e5;">${meetingTitle}</h3>`,
    `<p><strong>Type:</strong> ${typeLabel}</p>`,
    `<p><strong>Date:</strong> ${dateString}</p>`,
    `<p><strong>Time:</strong> ${timeRange}</p>`,
  ]

  if (location) {
    htmlParts.push(`<p><strong>Location:</strong> ${location}</p>`)
  }

  if (description) {
    htmlParts.push(`<p><strong>Description:</strong> ${description}</p>`)
  }

  htmlParts.push(`</div>`)

  if (meetingLink && meetingType === 'online') {
    htmlParts.push(
      `<div style="margin: 20px 0;">`,
      `<a href="${meetingLink}" style="display: inline-block; padding: 12px 24px; background: #4f46e5; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">Join Meeting</a>`,
      `</div>`
    )
  }

  htmlParts.push(
    `<div style="margin: 20px 0;">`,
    `<a href="${respondLink}" style="display: inline-block; padding: 10px 20px; background: #10b981; color: white; text-decoration: none; border-radius: 6px;">Respond to Invitation</a>`,
    `</div>`,
    `<p style="color: #6b7280; font-size: 14px;">Thanks,<br/>Talio HRMS</p>`,
    `</div>`
  )

  const html = htmlParts.join('\n')

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

  const responseText = response === 'accepted' ? 'accepted ✅' : 'declined ❌'
  const responseColor = response === 'accepted' ? '#10b981' : '#ef4444'

  const subject = `Meeting Response: ${inviteeName} ${response} - ${meetingTitle}`

  const textLines = [
    `Hi ${organizerName},`,
    '',
    `${inviteeName} has ${responseText} your meeting invitation.`,
    '',
    `Meeting: ${meetingTitle}`,
  ]

  if (reason && response === 'rejected') {
    textLines.push(`Reason: ${reason}`)
  }

  textLines.push('', 'Thanks,', 'Talio HRMS')

  const text = textLines.join('\n')

  const htmlParts = [
    `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">`,
    `<p>Hi ${organizerName},</p>`,
    `<p><strong>${inviteeName}</strong> has <span style="color: ${responseColor}; font-weight: bold;">${responseText}</span> your meeting invitation.</p>`,
    `<div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 15px 0;">`,
    `<p><strong>Meeting:</strong> ${meetingTitle}</p>`,
  ]

  if (reason && response === 'rejected') {
    htmlParts.push(`<p><strong>Reason:</strong> ${reason}</p>`)
  }

  htmlParts.push(
    `</div>`,
    `<p style="color: #6b7280; font-size: 14px;">Thanks,<br/>Talio HRMS</p>`,
    `</div>`
  )

  const html = htmlParts.join('\n')

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
  const typeLabel = meetingType === 'online' ? '📹 Online' : '📍 Offline'

  const subject = `⏰ Meeting Reminder: ${meetingTitle} starts in ${minutesUntilStart} minutes`

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

  textLines.push('', 'Thanks,', 'Talio HRMS')

  const text = textLines.join('\n')

  const htmlParts = [
    `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">`,
    `<p>Hi${greetingName},</p>`,
    `<p>⏰ <strong>Reminder:</strong> Your meeting "<strong>${meetingTitle}</strong>" starts in <strong>${minutesUntilStart} minutes</strong> at ${timeString}.</p>`,
    `<p><strong>Type:</strong> ${typeLabel}</p>`,
  ]

  if (location) {
    htmlParts.push(`<p><strong>Location:</strong> ${location}</p>`)
  }

  if (meetingLink && meetingType === 'online') {
    htmlParts.push(
      `<div style="margin: 20px 0;">`,
      `<a href="${meetingLink}" style="display: inline-block; padding: 12px 24px; background: #4f46e5; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">Join Meeting Now</a>`,
      `</div>`
    )
  }

  htmlParts.push(
    `<p style="color: #6b7280; font-size: 14px;">Thanks,<br/>Talio HRMS</p>`,
    `</div>`
  )

  const html = htmlParts.join('\n')

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

  const subject = `❌ Meeting Cancelled: ${meetingTitle}`

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

  textLines.push('', 'Thanks,', 'Talio HRMS')

  const text = textLines.join('\n')

  const htmlParts = [
    `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">`,
    `<p>Hi${greetingName},</p>`,
    `<p>❌ The following meeting has been <strong style="color: #ef4444;">cancelled</strong> by ${organizerName}:</p>`,
    `<div style="background: #fef2f2; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #ef4444;">`,
    `<p><strong>Meeting:</strong> ${meetingTitle}</p>`,
    `<p><strong>Originally scheduled for:</strong> ${dateTimeString}</p>`,
  ]

  if (reason) {
    htmlParts.push(`<p><strong>Reason:</strong> ${reason}</p>`)
  }

  htmlParts.push(
    `</div>`,
    `<p style="color: #6b7280; font-size: 14px;">Thanks,<br/>Talio HRMS</p>`,
    `</div>`
  )

  const html = htmlParts.join('\n')

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

  const subject = `📝 Meeting Minutes: ${meetingTitle}`

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

  textLines.push('', 'Thanks,', 'Talio HRMS')

  const text = textLines.join('\n')

  const htmlParts = [
    `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">`,
    `<p>Hi${greetingName},</p>`,
    `<p>Here are the minutes of meeting for "<strong>${meetingTitle}</strong>":</p>`,
    `<div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 15px 0;">`,
    `<h4 style="margin-top: 0; color: #374151;">📝 Meeting Minutes</h4>`,
    `<div style="white-space: pre-wrap;">${mom}</div>`,
    `</div>`,
  ]

  if (aiSummary) {
    htmlParts.push(
      `<div style="background: #eff6ff; padding: 20px; border-radius: 8px; margin: 15px 0;">`,
      `<h4 style="margin-top: 0; color: #4f46e5;">🤖 AI Summary</h4>`,
      `<div style="white-space: pre-wrap;">${aiSummary}</div>`,
      `</div>`
    )
  }

  if (meetingLink) {
    htmlParts.push(
      `<div style="margin: 20px 0;">`,
      `<a href="${meetingLink}" style="display: inline-block; padding: 10px 20px; background: #4f46e5; color: white; text-decoration: none; border-radius: 6px;">View Meeting Details</a>`,
      `</div>`
    )
  }

  htmlParts.push(
    `<p style="color: #6b7280; font-size: 14px;">Thanks,<br/>Talio HRMS</p>`,
    `</div>`
  )

  const html = htmlParts.join('\n')

  await sendEmail({ to, subject, text, html })
}
