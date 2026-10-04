import { NextResponse, after } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { getFinanceDatabase, listExpenses, saveExpense, deleteExpense, listPayroll, readPayroll, savePayroll, bulkPayroll, populateFinance } from '@/lib/finance.server'
import { deliverFinanceUpdate, sendPayslipEmails } from '@/lib/financeDelivery.server'

export async function financeApi(request, context, collection, action, detail = false) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const database = await getFinanceDatabase(auth), actor = auth.user, id = detail ? (await context.params).id : null
    const params = new URL(request.url).searchParams
    if (action === 'GET') {
      const data = collection === 'expenses' ? await listExpenses(database, actor, params) : id ? await readPayroll(database, actor, id) : await listPayroll(database, actor, params)
      return NextResponse.json({ success: true, data })
    }
    if (action === 'DELETE') {
      if (collection === 'expenses') await deleteExpense(database, actor, id)
      else await bulkPayroll(database, actor, [id], 'delete')
      return NextResponse.json({ success: true, message: 'Record deleted successfully' })
    }
    let input = await request.json()
    if (collection === 'payslips') input = { ...input, earnings: { basic: input.basicSalary || 0, hra: input.hra || 0, specialAllowance: input.allowances || 0, overtime: input.overtime || 0, bonus: input.bonus || 0 }, deductions: { tds: input.tax || 0, pf: input.pf || 0, esi: input.esi || 0, other: input.otherDeductions || 0 }, status: 'draft' }
    const record = collection === 'expenses' ? await saveExpense(database, actor, input, id) : await savePayroll(database, actor, input, id)
    const table = collection === 'expenses' ? 'expenses' : 'payrolls'
    after(async () => { await deliverFinanceUpdate(database, table, record, id ? 'updated' : 'created').catch(error => console.error('[Finance notification]', error.message)) })
    const data = (await populateFinance(database, table, [record]))[0]
    return NextResponse.json({ success: true, message: id ? 'Record updated successfully' : 'Record created successfully', data }, { status: id ? 200 : 201 })
  } catch (error) {
    console.error('[Finance API]', error.message)
    return NextResponse.json({ success: false, message: error.status ? error.message : 'Unable to process finance request' }, { status: error.status || 500 })
  }
}
export async function bulkPayrollApi(request, remove = false) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const database = await getFinanceDatabase(auth), body = await request.json()
    const records = await bulkPayroll(database, auth.user, body.payrollIds, remove ? 'delete' : body.action)
    let delivery = { emailsSent: 0, emailsFailed: 0, emailsSkipped: 0 }
    if (!remove && body.sendEmails && ['process', 'pay'].includes(body.action)) delivery = await sendPayslipEmails(database, records, body.action)
    if (!remove) after(async () => { for (const record of records) await deliverFinanceUpdate(database, 'payrolls', record, 'updated').catch(error => console.error('[Finance notification]', error.message)) })
    return NextResponse.json({ success: true, data: { [remove ? 'deleted' : 'updated']: records.length, ...delivery }, message: `${records.length} payroll(s) ${remove ? 'deleted' : 'updated'}` })
  } catch (error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'Unable to process payroll batch' }, { status: error.status || 500 }) }
}
