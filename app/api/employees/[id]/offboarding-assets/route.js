import mongoose from 'mongoose'
import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { buildCachePattern, clearCachePattern } from '@/lib/cache'
import { loadOffboardingAssetClearance } from '@/lib/hrms/offboardingAssets.server'
import { isFeatureEnabled } from '@/lib/planFeatures'
import queryCache from '@/lib/queryCache'
import { emitAssetUpdate } from '@/lib/realtimeEvents'

export const dynamic = 'force-dynamic'

const HR_ROLES = new Set(['admin', 'hr', 'superadmin'])
const RETURN_CONDITIONS = new Set(['excellent', 'good', 'fair', 'poor', 'damaged'])

function jsonError(message, status, code) {
  return NextResponse.json({ success: false, message, ...(code ? { code } : {}) }, { status })
}

function clearedSummary(checklist) {
  const cleared = checklist.filter((item) => ['returned', 'waived'].includes(item.status)).length
  return {
    total: checklist.length,
    cleared,
    pending: checklist.length - cleared,
    complete: checklist.length === cleared,
  }
}

async function authorize(request, employeeId) {
  if (!mongoose.Types.ObjectId.isValid(employeeId)) {
    return { response: jsonError('Invalid employee ID', 400, 'INVALID_EMPLOYEE_ID') }
  }
  const auth = await getAuthAndModels(request, ['Employee', 'Asset'])
  if (!auth.success) return { response: jsonError(auth.message || 'Unauthorized', 401, 'UNAUTHORIZED') }
  if (!HR_ROLES.has(auth.user?.role)) {
    return { response: jsonError('Only HR can manage offboarding asset clearance', 403, 'FORBIDDEN') }
  }
  if (!isFeatureEnabled(auth.companyFeatures, 'exitManagement')) {
    return { response: jsonError('Exit management is disabled for this tenant', 403, 'FEATURE_DISABLED') }
  }
  return { auth }
}

async function persistClearance(auth, employeeId, clearance) {
  await auth.models.Employee.updateOne(
    { _id: employeeId },
    {
      $set: {
        'lifecycle.offboarding.assetChecklist': clearance.checklist,
        'lifecycle.offboarding.assetsReturned': clearance.summary.complete,
      },
      $inc: { __v: 1 },
    },
  )
  await clearCachePattern(buildCachePattern({ tenantId: auth.tenant?.databaseName, namespace: 'employee:detail' })).catch(() => {})
  queryCache.clearPattern('employee')
}

async function loadClearance(auth, employeeId) {
  const employee = await auth.models.Employee.findById(employeeId)
    .select('_id firstName lastName lifecycle.offboarding')
    .lean()
  if (!employee) return { response: jsonError('Employee not found', 404, 'EMPLOYEE_NOT_FOUND') }
  if (!employee.lifecycle?.offboarding || employee.lifecycle.offboarding.status === 'not_started') {
    return { response: jsonError('Start offboarding before clearing assigned assets', 409, 'OFFBOARDING_NOT_STARTED') }
  }

  const clearance = await loadOffboardingAssetClearance({
    Asset: auth.models.Asset,
    employeeId: employee._id,
    offboarding: employee.lifecycle.offboarding,
  })
  if (clearance.changed) await persistClearance(auth, employee._id, clearance)
  return { employee, clearance }
}

function successPayload(employee, clearance, message) {
  return NextResponse.json({
    success: true,
    message,
    data: {
      employee: {
        _id: employee._id,
        name: `${employee.firstName || ''} ${employee.lastName || ''}`.trim(),
      },
      checklist: clearance.checklist,
      summary: clearance.summary,
    },
  })
}

export async function GET(request, { params }) {
  try {
    const { id } = await params
    const { auth, response } = await authorize(request, id)
    if (response) return response
    const state = await loadClearance(auth, id)
    if (state.response) return state.response
    return successPayload(state.employee, state.clearance, 'Asset clearance loaded')
  } catch (error) {
    console.error('[OffboardingAssets] Load failed:', error)
    return jsonError('Unable to load the offboarding asset checklist', 500, 'ASSET_CLEARANCE_ERROR')
  }
}

export async function PATCH(request, { params }) {
  try {
    const { id } = await params
    const { auth, response } = await authorize(request, id)
    if (response) return response

    let body
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON request body', 400, 'INVALID_JSON')
    }

    const action = String(body.action || '')
    const assetId = String(body.assetId || '')
    if (!['return', 'waive'].includes(action)) return jsonError('Unsupported asset clearance action', 400, 'INVALID_ACTION')
    if (!mongoose.Types.ObjectId.isValid(assetId)) return jsonError('Invalid asset ID', 400, 'INVALID_ASSET_ID')

    const state = await loadClearance(auth, id)
    if (state.response) return state.response
    const item = state.clearance.checklist.find((entry) => String(entry.asset) === assetId)
    if (!item) return jsonError('This asset is not connected to the employee offboarding checklist', 404, 'ASSET_NOT_ASSIGNED')
    if (['returned', 'waived'].includes(item.status)) {
      return successPayload(state.employee, state.clearance, 'Asset is already cleared')
    }

    const notes = String(body.notes || '').trim().slice(0, 1000)
    const actor = auth.user?.id || auth.user?._id
    const now = new Date()
    let returnedAsset = null

    if (action === 'waive') {
      if (!item.recordMissing) return jsonError('Only a missing asset record can be waived', 409, 'ASSET_RECORD_AVAILABLE')
      if (!notes) return jsonError('A reason is required to waive a missing asset record', 400, 'WAIVER_REASON_REQUIRED')
      Object.assign(item, { status: 'waived', notes, clearedAt: now, clearedBy: actor, recordMissing: true })
    } else {
      const returnCondition = String(body.returnCondition || 'good')
      if (!RETURN_CONDITIONS.has(returnCondition)) return jsonError('Select a valid return condition', 400, 'INVALID_RETURN_CONDITION')
      returnedAsset = await auth.models.Asset.findOneAndUpdate(
        { _id: assetId, assignedTo: id },
        {
          $set: { status: 'available', returnDate: now, condition: returnCondition, returnNotes: notes },
          $unset: { assignedTo: 1, assignedAt: 1, assignedDate: 1 },
        },
        { new: true, runValidators: true },
      ).lean()
      if (!returnedAsset) {
        return jsonError('The asset assignment changed. Refresh the checklist and try again.', 409, 'ASSET_ASSIGNMENT_CONFLICT')
      }
      Object.assign(item, {
        status: 'returned',
        returnCondition,
        notes,
        clearedAt: now,
        clearedBy: actor,
        recordMissing: false,
      })
    }

    const summary = clearedSummary(state.clearance.checklist)
    const clearance = {
      checklist: state.clearance.checklist,
      summary,
      offboarding: {
        ...state.clearance.offboarding,
        assetChecklist: state.clearance.checklist,
        assetsReturned: summary.complete,
      },
    }
    await persistClearance(auth, id, clearance)
    if (returnedAsset) emitAssetUpdate(returnedAsset, [], { action: 'returned', broadcast: true })

    return successPayload(
      state.employee,
      clearance,
      summary.complete ? 'All assigned assets are cleared' : 'Asset return recorded',
    )
  } catch (error) {
    console.error('[OffboardingAssets] Update failed:', error)
    return jsonError('Unable to update the offboarding asset checklist', 500, 'ASSET_CLEARANCE_ERROR')
  }
}
