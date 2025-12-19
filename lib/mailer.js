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

  const time =
    loginTime || new Date()

  const timeString = time.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
  })

  const greetingName = name ? ` ${name}` : ''

  const subject = 'New login to Talio'

  const textLines = [
    `Hi${greetingName},`,
    '',
    `You just logged in to Talio on ${timeString}.`,
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
    'Talio'
  )

  const text = textLines.join('\n')

  const htmlParts = [
    `<p>Hi${greetingName},</p>`,
    `<p>You just logged in to <strong>Talio</strong> on ${timeString}.</p>`,
  ]

  if (userAgent) {
    htmlParts.push(`<p><strong>Device:</strong> ${userAgent}</p>`)
  }

  if (ipAddress) {
    htmlParts.push(`<p><strong>IP Address:</strong> ${ipAddress}</p>`)
  }

  htmlParts.push(
    '<p>If this was not you, please contact your HR/administrator immediately.</p>',
    '<p>Thanks,<br/>Talio</p>'
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
    'Talio'
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
    `<p style="color: #6b7280; font-size: 14px;">Thanks,<br/>Talio</p>`,
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

  textLines.push('', 'Thanks,', 'Talio')

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
    `<p style="color: #6b7280; font-size: 14px;">Thanks,<br/>Talio</p>`,
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

  textLines.push('', 'Thanks,', 'Talio')

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
    `<p style="color: #6b7280; font-size: 14px;">Thanks,<br/>Talio</p>`,
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

  textLines.push('', 'Thanks,', 'Talio')

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
    `<p style="color: #6b7280; font-size: 14px;">Thanks,<br/>Talio</p>`,
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

  textLines.push('', 'Thanks,', 'Talio')

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
    `<p style="color: #6b7280; font-size: 14px;">Thanks,<br/>Talio</p>`,
    `</div>`
  )

  const html = htmlParts.join('\n')

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

  const fullName = `${firstName}${lastName ? ' ' + lastName : ''}`
  const joiningDate = dateOfJoining 
    ? new Date(dateOfJoining).toLocaleDateString('en-IN', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null

  const subject = `🎉 Welcome to Talio, ${firstName}!`

  // Plain text version
  const textLines = [
    `Hi ${firstName},`,
    '',
    `Welcome to the team! Your Talio account has been created.`,
    '',
    `Here are your login credentials:`,
    `Email: ${email}`,
    `Password: ${password}`,
    '',
    `Please change your password after your first login.`,
    '',
    `To get started:`,
    `1. Download the Talio desktop app: https://app.talio.in/resources`,
    `2. Install and launch the app`,
    `3. Log in with your credentials above`,
    '',
    `Login URL: https://app.talio.in/login`,
    '',
    `Need help? Contact your HR administrator.`,
    '',
    `Welcome aboard!`,
    'Talio Team'
  ]

  const text = textLines.join('\n')

  // Beautiful HTML email
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Talio</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0f0a1e; color: #ffffff;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse;">
          
          <!-- Header with Logo -->
          <tr>
            <td style="text-align: center; padding-bottom: 30px;">
              <table role="presentation" style="margin: 0 auto;">
                <tr>
                  <td style="vertical-align: middle; padding-right: 12px;">
                    <img src="https://app.talio.in/fox-icon.png" alt="Talio" width="48" height="48" style="border-radius: 12px; display: block;">
                  </td>
                  <td style="vertical-align: middle;">
                    <span style="font-size: 28px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">Talio</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Card -->
          <tr>
            <td>
              <table role="presentation" style="width: 100%; border-collapse: collapse; background: linear-gradient(135deg, #1a1030 0%, #0d0618 100%); border-radius: 24px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(139, 92, 246, 0.25);">
                
                <!-- Gradient Top Bar -->
                <tr>
                  <td style="height: 4px; background: linear-gradient(90deg, #8b5cf6 0%, #a855f7 50%, #d946ef 100%);"></td>
                </tr>

                <!-- Welcome Badge -->
                <tr>
                  <td style="padding: 40px 40px 20px 40px; text-align: center;">
                    <span style="display: inline-block; padding: 8px 20px; background: rgba(139, 92, 246, 0.2); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 50px; font-size: 13px; color: #a78bfa; font-weight: 600; letter-spacing: 0.5px;">
                      ✨ WELCOME TO THE TEAM
                    </span>
                  </td>
                </tr>

                <!-- Greeting -->
                <tr>
                  <td style="padding: 10px 40px 30px 40px; text-align: center;">
                    <h1 style="margin: 0 0 15px 0; font-size: 32px; font-weight: 700; color: #ffffff; line-height: 1.2;">
                      Hello, ${firstName}! 👋
                    </h1>
                    <p style="margin: 0; font-size: 16px; color: #a1a1aa; line-height: 1.6;">
                      Your Talio account is ready. Let's get you set up for success.
                    </p>
                  </td>
                </tr>

                ${joiningDate || designation || department ? `
                <!-- Employee Details -->
                <tr>
                  <td style="padding: 0 40px 30px 40px;">
                    <table role="presentation" style="width: 100%; border-collapse: collapse; background: rgba(139, 92, 246, 0.08); border-radius: 16px; border: 1px solid rgba(139, 92, 246, 0.15);">
                      <tr>
                        <td style="padding: 24px;">
                          <table role="presentation" style="width: 100%; border-collapse: collapse;">
                            ${designation ? `
                            <tr>
                              <td style="padding: 8px 0; color: #a1a1aa; font-size: 14px; width: 40%;">Role</td>
                              <td style="padding: 8px 0; color: #ffffff; font-size: 14px; font-weight: 600;">${designation}</td>
                            </tr>
                            ` : ''}
                            ${department ? `
                            <tr>
                              <td style="padding: 8px 0; color: #a1a1aa; font-size: 14px; width: 40%;">Department</td>
                              <td style="padding: 8px 0; color: #ffffff; font-size: 14px; font-weight: 600;">${department}</td>
                            </tr>
                            ` : ''}
                            ${joiningDate ? `
                            <tr>
                              <td style="padding: 8px 0; color: #a1a1aa; font-size: 14px; width: 40%;">Start Date</td>
                              <td style="padding: 8px 0; color: #ffffff; font-size: 14px; font-weight: 600;">${joiningDate}</td>
                            </tr>
                            ` : ''}
                            ${employeeCode ? `
                            <tr>
                              <td style="padding: 8px 0; color: #a1a1aa; font-size: 14px; width: 40%;">Employee ID</td>
                              <td style="padding: 8px 0; color: #a78bfa; font-size: 14px; font-weight: 600;">${employeeCode}</td>
                            </tr>
                            ` : ''}
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                ` : ''}

                <!-- Credentials Section -->
                <tr>
                  <td style="padding: 0 40px 30px 40px;">
                    <table role="presentation" style="width: 100%; border-collapse: collapse; background: linear-gradient(135deg, rgba(34, 197, 94, 0.1) 0%, rgba(16, 185, 129, 0.05) 100%); border-radius: 16px; border: 1px solid rgba(34, 197, 94, 0.2);">
                      <tr>
                        <td style="padding: 24px;">
                          <table role="presentation" style="width: 100%; border-collapse: collapse;">
                            <tr>
                              <td style="padding-bottom: 16px;">
                                <span style="display: inline-flex; align-items: center; font-size: 14px; font-weight: 600; color: #22c55e;">
                                  🔐 Your Login Credentials
                                </span>
                              </td>
                            </tr>
                            <tr>
                              <td style="padding: 8px 0;">
                                <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                  <tr>
                                    <td style="color: #a1a1aa; font-size: 13px; padding-bottom: 4px;">Email</td>
                                  </tr>
                                  <tr>
                                    <td style="background: rgba(0, 0, 0, 0.3); padding: 12px 16px; border-radius: 8px; font-family: 'Monaco', 'Consolas', monospace; font-size: 14px; color: #ffffff; letter-spacing: 0.3px;">
                                      ${email}
                                    </td>
                                  </tr>
                                </table>
                              </td>
                            </tr>
                            <tr>
                              <td style="padding: 12px 0 0 0;">
                                <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                  <tr>
                                    <td style="color: #a1a1aa; font-size: 13px; padding-bottom: 4px;">Temporary Password</td>
                                  </tr>
                                  <tr>
                                    <td style="background: rgba(0, 0, 0, 0.3); padding: 12px 16px; border-radius: 8px; font-family: 'Monaco', 'Consolas', monospace; font-size: 14px; color: #fbbf24; letter-spacing: 0.5px;">
                                      ${password}
                                    </td>
                                  </tr>
                                </table>
                              </td>
                            </tr>
                            <tr>
                              <td style="padding-top: 16px;">
                                <p style="margin: 0; font-size: 12px; color: #f59e0b; background: rgba(245, 158, 11, 0.1); padding: 10px 14px; border-radius: 8px; border-left: 3px solid #f59e0b;">
                                  ⚠️ Please change your password immediately after your first login.
                                </p>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Getting Started Steps -->
                <tr>
                  <td style="padding: 0 40px 30px 40px;">
                    <h3 style="margin: 0 0 20px 0; font-size: 18px; font-weight: 600; color: #ffffff;">
                      🚀 Getting Started
                    </h3>
                    <table role="presentation" style="width: 100%; border-collapse: collapse;">
                      <!-- Step 1 -->
                      <tr>
                        <td style="padding: 12px 0;">
                          <table role="presentation" style="width: 100%; border-collapse: collapse;">
                            <tr>
                              <td style="width: 44px; vertical-align: top;">
                                <div style="width: 36px; height: 36px; background: linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%); border-radius: 10px; text-align: center; line-height: 36px; font-weight: 700; font-size: 14px; color: #ffffff;">1</div>
                              </td>
                              <td style="vertical-align: top;">
                                <p style="margin: 0 0 4px 0; font-size: 15px; font-weight: 600; color: #ffffff;">Download the Talio App</p>
                                <p style="margin: 0; font-size: 13px; color: #a1a1aa;">Get the desktop app for macOS or Windows</p>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <!-- Step 2 -->
                      <tr>
                        <td style="padding: 12px 0;">
                          <table role="presentation" style="width: 100%; border-collapse: collapse;">
                            <tr>
                              <td style="width: 44px; vertical-align: top;">
                                <div style="width: 36px; height: 36px; background: linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%); border-radius: 10px; text-align: center; line-height: 36px; font-weight: 700; font-size: 14px; color: #ffffff;">2</div>
                              </td>
                              <td style="vertical-align: top;">
                                <p style="margin: 0 0 4px 0; font-size: 15px; font-weight: 600; color: #ffffff;">Install & Launch</p>
                                <p style="margin: 0; font-size: 13px; color: #a1a1aa;">Follow the installation wizard and open Talio</p>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <!-- Step 3 -->
                      <tr>
                        <td style="padding: 12px 0;">
                          <table role="presentation" style="width: 100%; border-collapse: collapse;">
                            <tr>
                              <td style="width: 44px; vertical-align: top;">
                                <div style="width: 36px; height: 36px; background: linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%); border-radius: 10px; text-align: center; line-height: 36px; font-weight: 700; font-size: 14px; color: #ffffff;">3</div>
                              </td>
                              <td style="vertical-align: top;">
                                <p style="margin: 0 0 4px 0; font-size: 15px; font-weight: 600; color: #ffffff;">Login & Start Working</p>
                                <p style="margin: 0; font-size: 13px; color: #a1a1aa;">Use your credentials above to sign in</p>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- CTA Buttons -->
                <tr>
                  <td style="padding: 0 40px 40px 40px;">
                    <table role="presentation" style="width: 100%; border-collapse: collapse;">
                      <tr>
                        <td style="padding-bottom: 12px;">
                          <a href="https://app.talio.in/resources" style="display: block; text-align: center; padding: 16px 32px; background: linear-gradient(135deg, #8b5cf6 0%, #a855f7 50%, #d946ef 100%); color: #ffffff; text-decoration: none; border-radius: 12px; font-size: 15px; font-weight: 600; box-shadow: 0 10px 30px -5px rgba(139, 92, 246, 0.4);">
                            ⬇️ Download Talio App
                          </a>
                        </td>
                      </tr>
                      <tr>
                        <td>
                          <a href="https://app.talio.in/login" style="display: block; text-align: center; padding: 14px 32px; background: rgba(139, 92, 246, 0.15); border: 1px solid rgba(139, 92, 246, 0.3); color: #a78bfa; text-decoration: none; border-radius: 12px; font-size: 14px; font-weight: 600;">
                            🌐 Login via Browser
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Help Section -->
                <tr>
                  <td style="padding: 0 40px 40px 40px;">
                    <table role="presentation" style="width: 100%; border-collapse: collapse; background: rgba(63, 63, 70, 0.3); border-radius: 12px;">
                      <tr>
                        <td style="padding: 20px; text-align: center;">
                          <p style="margin: 0; font-size: 14px; color: #a1a1aa;">
                            Need help? Contact your <span style="color: #ffffff;">HR Administrator</span> or reply to this email.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 30px 0; text-align: center;">
              <p style="margin: 0 0 10px 0; font-size: 13px; color: #71717a;">
                Sent with 💜 by Talio
              </p>
              <p style="margin: 0; font-size: 12px; color: #52525b;">
                HR that runs itself™
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`

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
}) {
  // Dynamic import to avoid circular dependencies
  const { default: OnboardingEmail } = await import('@/models/OnboardingEmail')
  const { default: connectDB } = await import('@/lib/mongodb')
  
  await connectDB()
  
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

  const subject = '🔐 Reset Your Talio Password'

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

  // Beautiful HTML email
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0f0a1e; color: #ffffff;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse;">
          
          <!-- Header with Logo -->
          <tr>
            <td style="text-align: center; padding-bottom: 30px;">
              <table role="presentation" style="margin: 0 auto;">
                <tr>
                  <td style="vertical-align: middle; padding-right: 12px;">
                    <img src="https://app.talio.in/fox-icon.png" alt="Talio" width="48" height="48" style="border-radius: 12px; display: block;">
                  </td>
                  <td style="vertical-align: middle;">
                    <span style="font-size: 28px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">Talio</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Card -->
          <tr>
            <td>
              <table role="presentation" style="width: 100%; border-collapse: collapse; background: linear-gradient(135deg, #1a1030 0%, #0d0618 100%); border-radius: 24px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(139, 92, 246, 0.25);">
                
                <!-- Gradient Top Bar -->
                <tr>
                  <td style="height: 4px; background: linear-gradient(90deg, #8b5cf6 0%, #a855f7 50%, #d946ef 100%);"></td>
                </tr>

                <!-- Lock Icon -->
                <tr>
                  <td style="padding: 40px 40px 20px 40px; text-align: center;">
                    <div style="display: inline-block; width: 80px; height: 80px; background: linear-gradient(135deg, rgba(139, 92, 246, 0.2) 0%, rgba(168, 85, 247, 0.1) 100%); border-radius: 20px; line-height: 80px;">
                      <span style="font-size: 36px;">🔐</span>
                    </div>
                  </td>
                </tr>

                <!-- Greeting -->
                <tr>
                  <td style="padding: 10px 40px 30px 40px; text-align: center;">
                    <h1 style="margin: 0 0 15px 0; font-size: 28px; font-weight: 700; color: #ffffff; line-height: 1.2;">
                      Reset Your Password
                    </h1>
                    <p style="margin: 0; font-size: 16px; color: #a1a1aa; line-height: 1.6;">
                      Hi ${firstName || 'there'}, we received a request to reset your password.
                    </p>
                  </td>
                </tr>

                <!-- Timer Warning -->
                <tr>
                  <td style="padding: 0 40px 30px 40px;">
                    <table role="presentation" style="width: 100%; border-collapse: collapse; background: rgba(245, 158, 11, 0.1); border-radius: 16px; border: 1px solid rgba(245, 158, 11, 0.2);">
                      <tr>
                        <td style="padding: 16px 20px;">
                          <table role="presentation" style="width: 100%; border-collapse: collapse;">
                            <tr>
                              <td style="width: 40px; vertical-align: top;">
                                <span style="font-size: 24px;">⏱️</span>
                              </td>
                              <td>
                                <p style="margin: 0; font-size: 14px; color: #fbbf24; font-weight: 600;">
                                  This link expires in ${expiresInMinutes} minutes
                                </p>
                                <p style="margin: 5px 0 0 0; font-size: 13px; color: #a1a1aa;">
                                  For security reasons, password reset links are time-limited.
                                </p>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- CTA Button -->
                <tr>
                  <td style="padding: 0 40px 30px 40px; text-align: center;">
                    <a href="${resetLink}" style="display: inline-block; padding: 16px 48px; background: linear-gradient(135deg, #8b5cf6 0%, #a855f7 50%, #d946ef 100%); color: #ffffff; text-decoration: none; border-radius: 12px; font-size: 16px; font-weight: 600; box-shadow: 0 10px 30px -5px rgba(139, 92, 246, 0.4);">
                      Reset Password
                    </a>
                  </td>
                </tr>

                <!-- Alternative Link -->
                <tr>
                  <td style="padding: 0 40px 30px 40px;">
                    <p style="margin: 0 0 10px 0; font-size: 13px; color: #71717a; text-align: center;">
                      Or copy and paste this link in your browser:
                    </p>
                    <p style="margin: 0; font-size: 12px; color: #a78bfa; word-break: break-all; text-align: center; background: rgba(0, 0, 0, 0.3); padding: 12px; border-radius: 8px;">
                      ${resetLink}
                    </p>
                  </td>
                </tr>

                <!-- Security Notice -->
                <tr>
                  <td style="padding: 0 40px 40px 40px;">
                    <table role="presentation" style="width: 100%; border-collapse: collapse; background: rgba(63, 63, 70, 0.3); border-radius: 12px;">
                      <tr>
                        <td style="padding: 16px 20px;">
                          <p style="margin: 0; font-size: 13px; color: #a1a1aa; line-height: 1.6;">
                            <strong style="color: #ffffff;">Didn't request this?</strong><br>
                            If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 30px 0; text-align: center;">
              <p style="margin: 0 0 10px 0; font-size: 13px; color: #71717a;">
                Sent with 💜 by Talio
              </p>
              <p style="margin: 0; font-size: 12px; color: #52525b;">
                HR that runs itself™
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`

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

  const subject = '✅ Your Talio Password Was Changed'

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

  // Beautiful HTML email
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Changed</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0f0a1e; color: #ffffff;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse;">
          
          <!-- Header with Logo -->
          <tr>
            <td style="text-align: center; padding-bottom: 30px;">
              <table role="presentation" style="margin: 0 auto;">
                <tr>
                  <td style="vertical-align: middle; padding-right: 12px;">
                    <img src="https://app.talio.in/fox-icon.png" alt="Talio" width="48" height="48" style="border-radius: 12px; display: block;">
                  </td>
                  <td style="vertical-align: middle;">
                    <span style="font-size: 28px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">Talio</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Card -->
          <tr>
            <td>
              <table role="presentation" style="width: 100%; border-collapse: collapse; background: linear-gradient(135deg, #1a1030 0%, #0d0618 100%); border-radius: 24px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(34, 197, 94, 0.2);">
                
                <!-- Gradient Top Bar - Green for success -->
                <tr>
                  <td style="height: 4px; background: linear-gradient(90deg, #22c55e 0%, #10b981 50%, #059669 100%);"></td>
                </tr>

                <!-- Success Icon -->
                <tr>
                  <td style="padding: 40px 40px 20px 40px; text-align: center;">
                    <div style="display: inline-block; width: 80px; height: 80px; background: linear-gradient(135deg, rgba(34, 197, 94, 0.2) 0%, rgba(16, 185, 129, 0.1) 100%); border-radius: 20px; line-height: 80px;">
                      <span style="font-size: 36px;">✅</span>
                    </div>
                  </td>
                </tr>

                <!-- Message -->
                <tr>
                  <td style="padding: 10px 40px 30px 40px; text-align: center;">
                    <h1 style="margin: 0 0 15px 0; font-size: 28px; font-weight: 700; color: #ffffff; line-height: 1.2;">
                      Password Changed Successfully
                    </h1>
                    <p style="margin: 0; font-size: 16px; color: #a1a1aa; line-height: 1.6;">
                      Hi ${firstName || 'there'}, your Talio password was changed.
                    </p>
                  </td>
                </tr>

                <!-- Details -->
                <tr>
                  <td style="padding: 0 40px 30px 40px;">
                    <table role="presentation" style="width: 100%; border-collapse: collapse; background: rgba(34, 197, 94, 0.08); border-radius: 16px; border: 1px solid rgba(34, 197, 94, 0.15);">
                      <tr>
                        <td style="padding: 20px;">
                          <table role="presentation" style="width: 100%; border-collapse: collapse;">
                            <tr>
                              <td style="padding: 8px 0; color: #a1a1aa; font-size: 14px;">Changed on</td>
                              <td style="padding: 8px 0; color: #ffffff; font-size: 14px; text-align: right; font-weight: 600;">${timeString}</td>
                            </tr>
                            ${ipAddress ? `
                            <tr>
                              <td style="padding: 8px 0; color: #a1a1aa; font-size: 14px;">IP Address</td>
                              <td style="padding: 8px 0; color: #ffffff; font-size: 14px; text-align: right; font-family: monospace;">${ipAddress}</td>
                            </tr>
                            ` : ''}
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Security Notice -->
                <tr>
                  <td style="padding: 0 40px 40px 40px;">
                    <table role="presentation" style="width: 100%; border-collapse: collapse; background: rgba(239, 68, 68, 0.1); border-radius: 12px; border: 1px solid rgba(239, 68, 68, 0.2);">
                      <tr>
                        <td style="padding: 16px 20px;">
                          <p style="margin: 0; font-size: 13px; color: #fca5a5; line-height: 1.6;">
                            <strong style="color: #ef4444;">⚠️ Didn't make this change?</strong><br>
                            If you didn't change your password, please contact your HR administrator immediately as your account may be compromised.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 30px 0; text-align: center;">
              <p style="margin: 0 0 10px 0; font-size: 13px; color: #71717a;">
                Sent with 💜 by Talio
              </p>
              <p style="margin: 0; font-size: 12px; color: #52525b;">
                HR that runs itself™
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`

  try {
    await sendEmail({ to, subject, text, html })
    console.log(`[mailer] Password changed email sent to ${to}`)
    return { success: true }
  } catch (error) {
    console.error(`[mailer] Failed to send password changed email to ${to}:`, error)
    return { success: false, error: error.message }
  }
}
