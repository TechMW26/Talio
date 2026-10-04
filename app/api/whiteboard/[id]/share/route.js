import { NextResponse } from 'next/server'
import { getProfileRecords } from '@/lib/platform/firestoreProfile.server'
import { getWhiteboardContext, assertWhiteboardAccess, populateWhiteboard, mutateWhiteboard, validateWhiteboardShares, boardError } from '@/lib/whiteboards.server'

export async function GET(request, { params }) {
  try {
    const context = await getWhiteboardContext(request)
    const board = await context.store.get('whiteboards', (await params).id)
    const permission = assertWhiteboardAccess(board, context)
    if (permission === 'view_only' && !(board.sharing || []).some(share => share.userId === context.userId)) throw boardError('Access denied', 403)
    const populated = await populateWhiteboard(context, board)
    return NextResponse.json({ sharedWith: populated.sharedWith, isPublic: board.isPublic, isOwner: permission === 'owner' })
  } catch (error) {
    return NextResponse.json({ error: error.status ? error.message : 'Failed to fetch sharing info' }, { status: error.status || 500 })
  }
}
export async function POST(request, { params }) {
  try {
    const context = await getWhiteboardContext(request)
    const { id } = await params
    assertWhiteboardAccess(await context.store.get('whiteboards', id), context, 'owner')
    const body = await request.json()
    let ids = body.employeeIds === undefined ? [] : await validateWhiteboardShares(context, body.employeeIds)
    if (body.email) {
      const target = (await context.store.list('users', { filters: [{ field: 'email', operator: '==', value: String(body.email).toLowerCase().trim() }], limit: 1 })).records[0]
      if (!target) throw boardError('User not found', 404)
      const { employee } = await getProfileRecords(context.store, target._id)
      if (!employee) throw boardError('Employee record not found', 404)
      if (employee._id === context.employeeId) throw boardError('Cannot share with yourself')
      ids.push(employee._id)
    }
    if (body.isPublic !== undefined && typeof body.isPublic !== 'boolean') throw boardError('Invalid public setting')
    const board = await mutateWhiteboard(context, id, current => ({ ...current,
      sharedWith: [...new Set([...(current.sharedWith || []), ...ids])],
      ...(body.isPublic !== undefined ? { isPublic: body.isPublic } : {}),
    }), { required: 'owner' })
    const populated = await populateWhiteboard(context, board)
    return NextResponse.json({ success: true, sharedWith: populated.sharedWith, isPublic: board.isPublic })
  } catch (error) {
    return NextResponse.json({ error: error.status ? error.message : 'Failed to share whiteboard' }, { status: error.status || 500 })
  }
}
export async function DELETE(request, { params }) {
  try {
    const context = await getWhiteboardContext(request)
    const employeeId = new URL(request.url).searchParams.get('employeeId')
    if (!employeeId) throw boardError('Employee ID required')
    const targetUsers = (await context.store.list('users', { filters: [{ field: 'employeeId', operator: '==', value: employeeId }], limit: 100 })).records.map(user => user._id)
    await mutateWhiteboard(context, (await params).id, board => ({ ...board,
      sharedWith: (board.sharedWith || []).filter(value => value !== employeeId),
      sharing: (board.sharing || []).filter(share => !targetUsers.includes(share.userId)),
    }), { required: 'owner' })
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: error.status ? error.message : 'Failed to remove share' }, { status: error.status || 500 })
  }
}
