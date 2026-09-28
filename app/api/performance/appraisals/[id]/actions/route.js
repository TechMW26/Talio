import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import {
  canActOnAppraisal,
  isValidAppraisalObjectId,
  notifyAppraisalUsers,
  objectIdString,
  transitionAppraisal,
} from '@/lib/hrms/performanceAppraisal.server'

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  try {
    const { id } = await params
    if (!isValidAppraisalObjectId(id)) {
      return NextResponse.json({ success: false, message: 'Invalid appraisal request ID' }, { status: 400 })
    }
    const auth = await getAuthAndModels(request, ['PerformanceAppraisal', 'User', 'Notification'])
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const actorId = objectIdString(auth.user?._id || auth.user?.userId)
    const actor = await auth.models.User.findById(actorId).select('role isActive').lean()
    if (!actor || actor.isActive === false) return NextResponse.json({ success: false, message: 'Active user account required' }, { status: 403 })

    let body
    try { body = await request.json() } catch {
      return NextResponse.json({ success: false, message: 'Invalid JSON request body' }, { status: 400 })
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ success: false, message: 'Request body must be an object' }, { status: 400 })
    }
    const appraisal = await auth.models.PerformanceAppraisal.findById(id).lean()
    if (!appraisal) return NextResponse.json({ success: false, message: 'Appraisal request not found' }, { status: 404 })
    if (!canActOnAppraisal(appraisal, { ...actor, _id: actorId })) {
      return NextResponse.json({ success: false, message: 'This request is not awaiting your approval' }, { status: 403 })
    }
    const currentStep = appraisal.approvalSteps?.[appraisal.currentStepIndex]
    if (currentStep?.role === 'hr' && body.action !== 'complete_discussion') {
      return NextResponse.json({ success: false, message: 'HR must complete the discussion with an outcome and notes' }, { status: 400 })
    }
    if (currentStep?.role !== 'hr' && body.action === 'complete_discussion') {
      return NextResponse.json({ success: false, message: 'Only the HR discussion stage can be completed this way' }, { status: 400 })
    }

    let transition
    try {
      transition = transitionAppraisal({
        appraisal,
        action: body.action,
        outcome: body.outcome,
        comment: body.comment,
        actorId,
        actorRole: actor.role,
      })
    } catch (error) {
      return NextResponse.json({ success: false, message: error.message }, { status: 400 })
    }

    const expectedVersion = Number(appraisal.workflowVersion || 1)
    const update = {
      $set: {
        status: transition.status,
        currentStepIndex: transition.currentStepIndex,
        approvalSteps: transition.approvalSteps,
        workflowVersion: expectedVersion + 1,
        ...(transition.hrDiscussion ? { hrDiscussion: transition.hrDiscussion } : {}),
      },
      $push: { timeline: transition.timelineEvent },
    }
    const updated = await auth.models.PerformanceAppraisal.findOneAndUpdate({
      _id: appraisal._id,
      workflowVersion: expectedVersion,
      currentStepIndex: appraisal.currentStepIndex,
      status: appraisal.status,
    }, update, { new: true, runValidators: true })
    if (!updated) return NextResponse.json({ success: false, message: 'This request changed while you were reviewing it. Refresh and try again.' }, { status: 409 })

    if (['approved', 'rejected'].includes(updated.status)) {
      await notifyAppraisalUsers(auth.models, [updated.requestedByUser], {
        title: updated.status === 'approved' ? 'Appraisal recommendation finalized' : 'Appraisal recommendation declined',
        message: `The appraisal request for ${updated.reviewPeriod} has been ${updated.status}.`,
        appraisalId: updated._id,
        employeeId: updated.employee,
      })
    } else {
      const nextStep = updated.approvalSteps[updated.currentStepIndex]
      const recipients = nextStep.role === 'hr' ? nextStep.approverUsers : [nextStep.approverUser]
      await notifyAppraisalUsers(auth.models, recipients, {
        title: nextStep.role === 'hr' ? 'Appraisal ready for HR discussion' : 'Performance appraisal awaiting your review',
        message: `A proposed ${updated.proposedIncreasePercent}% appraisal for ${updated.reviewPeriod} is ready for the ${nextStep.role.replace('_', ' ')} stage.`,
        appraisalId: updated._id,
        employeeId: updated.employee,
      })
    }

    return NextResponse.json({ success: true, message: 'Appraisal review saved', data: updated })
  } catch (error) {
    console.error('[Performance Appraisal] Action failed:', error)
    return NextResponse.json({ success: false, message: 'Could not save appraisal review' }, { status: 500 })
  }
}
