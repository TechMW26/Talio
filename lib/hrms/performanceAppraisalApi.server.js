import { NextResponse, after } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { performanceDatabase } from '@/lib/performanceStore.server'
import { listAppraisals, createAppraisal, actOnAppraisal, populateAppraisals } from './performanceAppraisalStore.server'
import { notifyAppraisalUsers } from './performanceAppraisal.server'
export async function appraisalApi(request, context, method) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const database = await performanceDatabase(auth)
    if (method === 'GET') return NextResponse.json({ success: true, ...await listAppraisals(database, auth.user, new URL(request.url).searchParams) })
    const input = await request.json()
    const record = context ? await actOnAppraisal(database, auth.user, (await context.params).id, input) : await createAppraisal(database, auth.user, input)
    after(async () => {
      const done = ['approved', 'rejected'].includes(record.status), step = record.approvalSteps[record.currentStepIndex]
      const recipients = done ? [record.requestedByUser] : step.role === 'hr' ? step.approverUsers : [step.approverUser]
      await notifyAppraisalUsers(database, recipients, { title: done ? 'Appraisal recommendation finalized' : 'Performance appraisal awaiting review', message: `The appraisal for ${record.reviewPeriod} is ${record.status.replaceAll('_', ' ')}.`, appraisalId: record._id, employeeId: record.employee, workflowVersion: record.workflowVersion })
    })
    return NextResponse.json({ success: true, message: context ? 'Appraisal review saved' : 'Appraisal submitted for review', data: (await populateAppraisals(database, [record], auth.user))[0] }, { status: context ? 200 : 201 })
  } catch (error) {
    console.error('[Appraisal]', error.message)
    return NextResponse.json({ success: false, message: error.status ? error.message : 'Could not process appraisal request' }, { status: error.status || 500 })
  }
}
