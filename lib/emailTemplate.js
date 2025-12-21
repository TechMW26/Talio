/**
 * Common Email Template System for Talio
 * Professional, clean design with white background and Talio branding
 * 
 * Brand Colors:
 * - Primary Blue: #3b82f6
 * - Dark Blue: #1e40af
 * - Text Dark: #1e293b
 * - Text Muted: #64748b
 * - Border: #e2e8f0
 * - Background Light: #f8fafc
 */

// Logo as base64 data URI (small blue Talio icon) - ensures consistent loading
// Using a simple SVG logo that will always render
const TALIO_LOGO_SVG = `<svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="40" height="40" rx="8" fill="#3b82f6"/>
  <path d="M12 14H28V17H22V28H18V17H12V14Z" fill="white"/>
</svg>`

// Base64 encode the SVG for email embedding
const TALIO_LOGO_BASE64 = `data:image/svg+xml;base64,${Buffer.from(TALIO_LOGO_SVG).toString('base64')}`

/**
 * Generate the common email wrapper template
 * @param {Object} options
 * @param {string} options.title - Email title for header
 * @param {string} options.preheader - Optional preheader text (hidden preview text)
 * @param {string} options.content - Main HTML content to wrap
 * @param {string} options.accentColor - Optional accent color (defaults to brand blue)
 * @returns {string} Complete HTML email
 */
export function wrapEmailTemplate({ title, preheader = '', content, accentColor = '#3b82f6' }) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${title}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
    a { color: #3b82f6; text-decoration: none; }
    @media only screen and (max-width: 600px) {
      .mobile-padding { padding: 16px !important; }
      .mobile-full-width { width: 100% !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f8fafc; color: #1e293b; line-height: 1.5;">
  ${preheader ? `<div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">${preheader}</div>` : ''}
  
  <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f8fafc;">
    <tr>
      <td align="center" style="padding: 24px 16px;">
        <table role="presentation" style="width: 100%; max-width: 560px; border-collapse: collapse;">
          
          <!-- Logo Header -->
          <tr>
            <td style="text-align: center; padding-bottom: 16px;">
              <table role="presentation" style="margin: 0 auto;">
                <tr>
                  <td style="vertical-align: middle; padding-right: 10px;">
                    <img src="${TALIO_LOGO_BASE64}" alt="Talio" width="36" height="36" style="display: block; border-radius: 8px;">
                  </td>
                  <td style="vertical-align: middle;">
                    <span style="font-size: 22px; font-weight: 700; color: #1e293b; letter-spacing: -0.3px;">Talio</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content Card -->
          <tr>
            <td>
              <table role="presentation" style="width: 100%; border-collapse: collapse; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0;">
                
                <!-- Accent Bar -->
                <tr>
                  <td style="height: 3px; background: ${accentColor};"></td>
                </tr>

                <!-- Content -->
                <tr>
                  <td class="mobile-padding" style="padding: 24px;">
                    ${content}
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 16px 0; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #94a3b8;">
                Talio | Workforce Management
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/**
 * Generate a styled button
 */
export function emailButton(text, href, color = '#3b82f6') {
  return `
    <a href="${href}" style="display: inline-block; padding: 10px 20px; background-color: ${color}; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600; text-align: center;">
      ${text}
    </a>
  `
}

/**
 * Generate a secondary/outline button
 */
export function emailButtonOutline(text, href, color = '#3b82f6') {
  return `
    <a href="${href}" style="display: inline-block; padding: 9px 19px; background-color: #ffffff; color: ${color}; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600; text-align: center; border: 1px solid ${color};">
      ${text}
    </a>
  `
}

/**
 * Generate an info box
 */
export function emailInfoBox(content, type = 'default') {
  const colors = {
    default: { bg: '#f8fafc', border: '#e2e8f0', text: '#1e293b' },
    success: { bg: '#f0fdf4', border: '#bbf7d0', text: '#166534' },
    warning: { bg: '#fffbeb', border: '#fde68a', text: '#92400e' },
    error: { bg: '#fef2f2', border: '#fecaca', text: '#991b1b' },
    info: { bg: '#eff6ff', border: '#bfdbfe', text: '#1e40af' },
  }
  const { bg, border, text } = colors[type] || colors.default
  
  return `
    <table role="presentation" style="width: 100%; border-collapse: collapse; background: ${bg}; border-radius: 8px; border: 1px solid ${border}; margin: 12px 0;">
      <tr>
        <td style="padding: 12px; color: ${text}; font-size: 14px;">
          ${content}
        </td>
      </tr>
    </table>
  `
}

/**
 * Generate a detail row (label: value)
 */
export function emailDetailRow(label, value) {
  return `
    <tr>
      <td style="padding: 6px 0; color: #64748b; font-size: 13px; width: 40%;">${label}</td>
      <td style="padding: 6px 0; color: #1e293b; font-size: 13px; font-weight: 500;">${value}</td>
    </tr>
  `
}

/**
 * Generate a details table wrapper
 */
export function emailDetailsTable(rows) {
  return `
    <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; margin: 12px 0;">
      <tr>
        <td style="padding: 12px;">
          <table role="presentation" style="width: 100%; border-collapse: collapse;">
            ${rows}
          </table>
        </td>
      </tr>
    </table>
  `
}

/**
 * Generate a section heading
 */
export function emailHeading(text, size = 'large') {
  const styles = {
    large: 'font-size: 20px; font-weight: 700; color: #1e293b; margin: 0 0 12px 0;',
    medium: 'font-size: 16px; font-weight: 600; color: #1e293b; margin: 0 0 8px 0;',
    small: 'font-size: 14px; font-weight: 600; color: #64748b; margin: 0 0 8px 0; text-transform: uppercase; letter-spacing: 0.5px;',
  }
  return `<p style="${styles[size] || styles.large}">${text}</p>`
}

/**
 * Generate paragraph text
 */
export function emailParagraph(text, muted = false) {
  return `<p style="margin: 0 0 12px 0; font-size: 14px; color: ${muted ? '#64748b' : '#1e293b'}; line-height: 1.6;">${text}</p>`
}

/**
 * Generate a divider
 */
export function emailDivider() {
  return `<hr style="border: none; border-top: 1px solid #e2e8f0; margin: 16px 0;">`
}

/**
 * Generate credential display box
 */
export function emailCredentialBox(label, value, isPassword = false) {
  return `
    <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 8px 0;">
      <tr>
        <td style="padding: 0 0 4px 0; color: #64748b; font-size: 12px;">${label}</td>
      </tr>
      <tr>
        <td style="background: #ffffff; padding: 10px 12px; border-radius: 6px; font-family: 'Monaco', 'Consolas', monospace; font-size: 13px; color: ${isPassword ? '#d97706' : '#1e293b'}; border: 1px solid #e2e8f0;">
          ${value}
        </td>
      </tr>
    </table>
  `
}

export default {
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
}
