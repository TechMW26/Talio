import { createHash } from 'node:crypto'
import { sendPushToUser } from '@/lib/pushNotification'
import { sendEmail } from '@/lib/mailer'
import { emitExpenseUpdate, emitPayrollUpdate } from '@/lib/realtimeEvents'
import { collectFirestorePages } from '@/lib/platform/firestoreQueries.server'
import { financeId, financeFilter, canApproveExpense, populateFinance } from '@/lib/finance.server'

// Persist a claim before provider delivery. An unknown SMTP outcome must not be
// retried automatically: it may already have delivered the financial document.
async function once(database, key, operation) {
  const id = createHash('sha256').update(key).digest('hex')
  const claimed = await database.transaction(async tx => {
    if (await tx.get('financedeliveries', id)) return false
    await tx.create('financedeliveries', { _id: id, status: 'sending', createdAt: new Date() })
    return true
  })
  if (!claimed) return 'skipped'
  try {
    await operation()
    await database.mutate('financedeliveries', id, row => ({ ...row, status: 'sent', updatedAt: new Date() }))
    return 'sent'
  } catch (error) {
    await database.mutate('financedeliveries', id, row => ({ ...row, status: 'unknown', updatedAt: new Date() })).catch(() => {})
    return 'failed'
  }
}
export async function deliverFinanceUpdate(database, collection, record, action) {
  const employee = await database.get('employees', financeId(record.employee))
  if (!employee) return
  const version = +new Date(record.updatedAt), payroll = collection === 'payrolls'
  const populated = (await populateFinance(database, collection, [record]))[0]
  if (employee.userId) {
    const user = financeId(employee.userId)
    if (payroll) emitPayrollUpdate(populated, [user], { action })
    else emitExpenseUpdate(populated, [user], { action })
    if (payroll || ['approved', 'rejected', 'reimbursed'].includes(record.status)) {
      await once(database, `${collection}-${record._id}-${version}-${user}-push`, () => sendPushToUser(user,
        { title: payroll ? 'Payroll updated' : 'Expense updated', body: payroll ? `Your payroll for ${record.month}/${record.year} is ${record.status}` : `Your expense request is ${record.status}` },
        { database, clickAction: payroll ? '/dashboard/payroll' : '/dashboard/expenses', eventType: payroll ? 'payroll_update' : 'expense_update', data: { recordId: record._id, status: record.status } }))
    }
  }
  if (!payroll) {
    const department = employee.department ? await database.get('departments', financeId(employee.department)) : null
    const users = await collectFirestorePages(database, 'users', { filters: [financeFilter('isActive', true), financeFilter('role', ['admin', 'super_admin', 'hr', 'manager', 'department_head'], 'in')] })
    emitExpenseUpdate(populated, users.filter(user => canApproveExpense(user, employee, department)).map(user => user._id), { action, isNew: action === 'created' })
  }
}
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))
export async function sendPayslipEmails(database, records, action) {
  const summary = { emailsSent: 0, emailsFailed: 0, emailsSkipped: 0 }
  const settings = (await database.list('companysettings', { limit: 2 })).records
  if (settings.length > 1) return { ...summary, emailsFailed: records.length }
  const raw = settings[0] || {}
  const companySettings = { ...raw, companyName: escapeHtml(raw.companyName), companyLogo: /^https:\/\//.test(raw.companyLogo || '') ? escapeHtml(raw.companyLogo) : '', companyAddress: Object.fromEntries(Object.entries(raw.companyAddress || {}).map(([key, value]) => [key, escapeHtml(value)])) }
  const populated = await populateFinance(database, 'payrolls', records)
  for (let offset = 0; offset < records.length; offset += 4) await Promise.all(records.slice(offset, offset + 4).map(async (record, index) => {
    const employee = await database.get('employees', financeId(record.employee))
    if (!employee?.email) { summary.emailsFailed++; return }
    const formatted = populated[offset + index]
    const safeEmployee = { ...formatted.employee, firstName: escapeHtml(employee.firstName), lastName: escapeHtml(employee.lastName), employeeCode: escapeHtml(employee.employeeCode), department: { name: escapeHtml(formatted.employee?.department?.name) }, designation: { title: escapeHtml(formatted.employee?.designation?.title) } }
    const monthName = new Date(Date.UTC(record.year, record.month - 1, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })
    const formatCurrency = amount => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(amount) || 0)
    const payroll = { ...record, earnings: record.earnings || record.earningsBreakdown || {}, deductions: typeof record.deductions === 'object' ? record.deductions : record.deductionsBreakdown || {} }
    const result = await once(database, `payslip-${record._id}-${action}`, () => sendEmail({ to: employee.email, subject: `${raw.companyName || 'Company'} - Salary Slip for ${monthName} ${record.year}`, html: generatePayslipEmailHtml({ payroll, employee: safeEmployee, monthName, companySettings, formatCurrency, action }) }))
    summary[result === 'sent' ? 'emailsSent' : result === 'failed' ? 'emailsFailed' : 'emailsSkipped']++
  }))
  return summary
}
function generatePayslipEmailHtml({ payroll, employee, monthName, companySettings, formatCurrency, action }) {
  const companyName = companySettings?.companyName || 'Company'
  const companyLogo = companySettings?.companyLogo || ''
  const companyAddress = companySettings?.companyAddress || {}

  const addressLine = [
    companyAddress.street,
    companyAddress.city,
    companyAddress.state,
    companyAddress.zipCode,
    companyAddress.country
  ].filter(Boolean).join(', ')

  // Get earnings breakdown
  const earnings = payroll.earnings || {}
  const deductions = payroll.deductions || {}

  const statusText = action === 'pay' ? 'paid' : 'processed'
  const statusColor = action === 'pay' ? '#22c55e' : '#3b82f6'

  // Base64 encoded Talio fox logo SVG
  const talioLogoBase64 = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MTIgNTEyIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImZveEdyYWQiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjEwMCUiPjxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiNmOTczMTYiLz48c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9IiNlYTU4MGMiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48Y2lyY2xlIGN4PSIyNTYiIGN5PSIyNTYiIHI9IjI0MCIgZmlsbD0idXJsKCNmb3hHcmFkKSIvPjxwYXRoIGQ9Ik0xNjAgMTYwbDQwIDYwIDU2LTMwIDU2IDMwIDQwLTYwIiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmYiIHN0cm9rZS13aWR0aD0iMTYiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjxjaXJjbGUgY3g9IjIwMCIgY3k9IjI0MCIgcj0iMjAiIGZpbGw9IiNmZmYiLz48Y2lyY2xlIGN4PSIzMTIiIGN5PSIyNDAiIHI9IjIwIiBmaWxsPSIjZmZmIi8+PHBhdGggZD0iTTIyMCAzMjBxMzYgMzAgNzIgMCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjEyIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48cGF0aCBkPSJNMjU2IDI4MHYzMCIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjEwIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48L3N2Zz4='

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Salary Slip - ${monthName} ${payroll.year}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 20px; background-color: #f8fafc;">
  <div style="max-width: 650px; margin: 0 auto; background-color: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">

    <!-- Talio Header -->
    <div style="background-color: #3b82f6; padding: 16px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="vertical-align: middle;">
            <img src="${talioLogoBase64}" alt="Talio" width="32" height="32" style="vertical-align: middle; border-radius: 6px;">
            <span style="color: white; font-size: 20px; font-weight: 600; margin-left: 10px; vertical-align: middle;">Talio</span>
          </td>
          <td style="text-align: right; color: white;">
            <span style="font-size: 14px;">Salary Slip</span>
          </td>
        </tr>
      </table>
    </div>

    <!-- Company & Period Header -->
    <div style="background-color: #f8fafc; padding: 20px 24px; border-bottom: 1px solid #e2e8f0;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            ${companyLogo ? `<img src="${companyLogo}" alt="${companyName}" style="height: 40px; max-width: 120px;">` : `<h2 style="margin: 0; font-size: 18px; color: #1e293b;">${companyName}</h2>`}
          </td>
          <td style="text-align: right;">
            <p style="margin: 0; font-size: 16px; font-weight: 600; color: #1e293b;">${monthName} ${payroll.year}</p>
          </td>
        </tr>
      </table>
    </div>

    <!-- Status Banner -->
    <div style="background-color: ${statusColor}; color: white; padding: 12px 24px; text-align: center;">
      <strong>Your salary for ${monthName} ${payroll.year} has been ${statusText}</strong>
    </div>

    <!-- Employee Details -->
    <div style="padding: 20px 24px;">
      <table width="100%" cellpadding="8" cellspacing="0" style="background-color: #f8fafc; border-radius: 6px; margin-bottom: 16px;">
        <tr>
          <td style="width: 50%;">
            <span style="color: #64748b; font-size: 11px; text-transform: uppercase;">Employee Name</span><br>
            <span style="font-size: 14px; color: #1e293b;">${employee.firstName} ${employee.lastName}</span>
          </td>
          <td style="width: 50%;">
            <span style="color: #64748b; font-size: 11px; text-transform: uppercase;">Employee ID</span><br>
            <span style="font-size: 14px; color: #1e293b;">${employee.employeeCode || 'N/A'}</span>
          </td>
        </tr>
        <tr>
          <td>
            <span style="color: #64748b; font-size: 11px; text-transform: uppercase;">Department</span><br>
            <span style="font-size: 14px; color: #1e293b;">${employee.department?.name || 'N/A'}</span>
          </td>
          <td>
            <span style="color: #64748b; font-size: 11px; text-transform: uppercase;">Designation</span><br>
            <span style="font-size: 14px; color: #1e293b;">${employee.designation?.title || 'N/A'}</span>
          </td>
        </tr>
      </table>

      <!-- Earnings & Deductions -->
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <!-- Earnings -->
          <td style="width: 48%; vertical-align: top;">
            <div style="background-color: #f0fdf4; border-radius: 6px; padding: 14px; border: 1px solid #bbf7d0;">
              <h3 style="margin: 0 0 10px; color: #16a34a; font-size: 12px; text-transform: uppercase;">Earnings</h3>
              <table width="100%" cellpadding="3" cellspacing="0" style="font-size: 12px; color: #1e293b;">
                <tr><td>Basic Salary</td><td style="text-align: right;">${formatCurrency(earnings.basic || 0)}</td></tr>
                <tr><td>HRA</td><td style="text-align: right;">${formatCurrency(earnings.hra || 0)}</td></tr>
                <tr><td>Conveyance</td><td style="text-align: right;">${formatCurrency(earnings.conveyance || 0)}</td></tr>
                <tr><td>Medical</td><td style="text-align: right;">${formatCurrency(earnings.medicalAllowance || 0)}</td></tr>
                <tr><td>Special Allowance</td><td style="text-align: right;">${formatCurrency(earnings.specialAllowance || 0)}</td></tr>
                <tr><td>Overtime</td><td style="text-align: right;">${formatCurrency(earnings.overtime || 0)}</td></tr>
                <tr style="border-top: 1px solid #16a34a;">
                  <td style="padding-top: 6px;"><strong>Gross Salary</strong></td>
                  <td style="text-align: right; padding-top: 6px;"><strong>${formatCurrency(payroll.grossSalary)}</strong></td>
                </tr>
              </table>
            </div>
          </td>

          <td style="width: 4%;"></td>

          <!-- Deductions -->
          <td style="width: 48%; vertical-align: top;">
            <div style="background-color: #fef2f2; border-radius: 6px; padding: 14px; border: 1px solid #fecaca;">
              <h3 style="margin: 0 0 10px; color: #dc2626; font-size: 12px; text-transform: uppercase;">Deductions</h3>
              <table width="100%" cellpadding="3" cellspacing="0" style="font-size: 12px; color: #1e293b;">
                <tr><td>Provident Fund</td><td style="text-align: right;">${formatCurrency(deductions.pf || 0)}</td></tr>
                <tr><td>ESI</td><td style="text-align: right;">${formatCurrency(deductions.esi || 0)}</td></tr>
                <tr><td>Professional Tax</td><td style="text-align: right;">${formatCurrency(deductions.professionalTax || 0)}</td></tr>
                <tr><td>TDS</td><td style="text-align: right;">${formatCurrency(deductions.tds || 0)}</td></tr>
                <tr><td>Late/Attendance</td><td style="text-align: right;">${formatCurrency(deductions.lateDeduction || 0)}</td></tr>
                <tr><td>Other</td><td style="text-align: right;">${formatCurrency(deductions.other || 0)}</td></tr>
                <tr style="border-top: 1px solid #dc2626;">
                  <td style="padding-top: 6px;"><strong>Total Deductions</strong></td>
                  <td style="text-align: right; padding-top: 6px;"><strong>${formatCurrency(payroll.totalDeductions)}</strong></td>
                </tr>
              </table>
            </div>
          </td>
        </tr>
      </table>

      <!-- Net Salary -->
      <div style="background-color: #3b82f6; border-radius: 6px; padding: 16px; margin-top: 16px; text-align: center; color: white;">
        <p style="margin: 0; font-size: 12px; opacity: 0.9; text-transform: uppercase;">Net Salary</p>
        <h2 style="margin: 6px 0 0; font-size: 28px;">${formatCurrency(payroll.netSalary)}</h2>
      </div>

      <!-- Attendance Summary -->
      ${payroll.presentDays !== undefined ? `
      <div style="margin-top: 16px; padding: 14px; background-color: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0;">
        <h3 style="margin: 0 0 10px; color: #1e293b; font-size: 12px; text-transform: uppercase;">Attendance Summary</h3>
        <table width="100%" cellpadding="4" cellspacing="0" style="font-size: 12px; color: #1e293b;">
          <tr>
            <td>Working Days: <strong>${payroll.workingDays || 26}</strong></td>
            <td>Present Days: <strong>${payroll.presentDays || 0}</strong></td>
            <td>Absent Days: <strong>${payroll.absentDays || 0}</strong></td>
            <td>Leave Days: <strong>${payroll.leaveDays || 0}</strong></td>
          </tr>
        </table>
      </div>
      ` : ''}
    </div>

    <!-- Footer -->
    <div style="background-color: #3b82f6; padding: 14px 24px; text-align: center;">
      <p style="margin: 0; font-size: 11px; color: rgba(255,255,255,0.9);">
        This is a system-generated salary slip. For any queries, please contact HR.
      </p>
      ${addressLine ? `<p style="margin: 6px 0 0; font-size: 10px; color: rgba(255,255,255,0.7);">${companyName} | ${addressLine}</p>` : ''}
    </div>
  </div>
</body>
</html>
  `
}
