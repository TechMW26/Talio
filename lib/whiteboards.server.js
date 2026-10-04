import { getAuthAndDatabase } from '@/lib/auth'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { getProfileRecords } from '@/lib/platform/firestoreProfile.server'
import { listScreenshotMaintenanceRecords } from '@/lib/platform/firestoreScreenshots.server'

export const boardId = value => String(value?._id || value || '')
export const boardError = (message, status = 400) => Object.assign(new Error(message), { status })
export async function getWhiteboardContext(request) {
  const auth = await getAuthAndDatabase(request)
  if (!auth.success) throw boardError(auth.message, 401)
  const store = await getFirestoreTenantDatabase(auth.tenant.databaseName, { queryFields: {
    whiteboards: ['owner', 'createdBy', 'sharedWith', 'sharedUserIds', 'updatedAt'], employees: ['userId'], users: ['email', 'employeeId'],
  } })
  const { user, employee } = await getProfileRecords(store, auth.user._id || auth.user.userId)
  if (!user) throw boardError('User not found', 401)
  return { store, userId: boardId(user._id), employeeId: boardId(employee?._id), databaseName: auth.tenant.databaseName }
}
export function whiteboardPermission(board, context) {
  if (!board) return null
  if ((context.userId && boardId(board.owner) === context.userId) || (context.employeeId && boardId(board.createdBy) === context.employeeId)) return 'owner'
  const share = (board.sharing || []).find(value => boardId(value.userId) === context.userId)
  if (share && ['owner', 'editor', 'view_only'].includes(share.permission)) return share.permission
  if (context.employeeId && (board.sharedWith || []).some(value => boardId(value) === context.employeeId)) return 'editor'
  return board.isPublic ? 'view_only' : null
}
export function assertWhiteboardAccess(board, context, required = 'view_only') {
  if (!board) throw boardError('Whiteboard not found', 404)
  const permission = whiteboardPermission(board, context)
  if (({ view_only: 1, editor: 2, owner: 3 }[permission] || 0) < ({ view_only: 1, editor: 2, owner: 3 }[required] || 99)) throw boardError('Access denied', 403)
  return permission
}
const publicEmployee = record => record ? Object.fromEntries(['_id', 'firstName', 'lastName', 'email', 'profilePicture'].filter(key => record[key] !== undefined).map(key => [key, record[key]])) : null
export async function populateWhiteboard(context, board, { summary = false } = {}) {
  const result = summary ? Object.fromEntries(['_id', 'title', 'name', 'description', 'thumbnail', 'createdBy', 'sharedWith', 'isPublic', 'createdAt', 'updatedAt'].filter(key => board[key] !== undefined).map(key => [key, board[key]])) : { ...board }
  result.createdBy = board.createdBy ? publicEmployee(await context.store.get('employees', boardId(board.createdBy))) : null
  result.sharedWith = (await Promise.all((board.sharedWith || []).map(async value => publicEmployee(await context.store.get('employees', boardId(value)))))).filter(Boolean)
  result.title = board.title || board.name || 'Untitled Board'
  result.owner = result.createdBy || board.owner
  result.userPermission = whiteboardPermission(board, context)
  result.isOwner = result.userPermission === 'owner'
  return result
}
export async function listVisibleWhiteboards(context) {
  const clauses = [{ field: 'owner', operator: '==', value: context.userId }, { field: 'sharedUserIds', operator: 'array-contains', value: context.userId }]
  if (context.employeeId) clauses.push({ field: 'createdBy', operator: '==', value: context.employeeId }, { field: 'sharedWith', operator: 'array-contains', value: context.employeeId })
  const results = await Promise.all(clauses.map(filter => listScreenshotMaintenanceRecords(context.store, 'whiteboards', [filter], 10000)))
  return [...new Map(results.flat().map(board => [board._id, board])).values()].filter(board => whiteboardPermission(board, context))
}

export async function mutateWhiteboard(context, id, callback, { required = 'editor', expectedUpdatedAt } = {}) {
  let result
  await context.store.transaction(async tx => {
    const board = await tx.get('whiteboards', id)
    assertWhiteboardAccess(board, context, required)
    if (expectedUpdatedAt !== undefined && new Date(board.updatedAt || 0).getTime() !== new Date(expectedUpdatedAt || 0).getTime()) throw boardError('Whiteboard changed. Reload before saving.', 409)
    const next = await callback(board)
    result = { ...next, _id: id, updatedAt: new Date(), lastModified: new Date(), lastModifiedBy: context.userId }
    await tx.replace('whiteboards', result)
  })
  return result
}

export async function saveWhiteboardAnalysis(context, board) {
  const saved = await mutateWhiteboard(context, board._id, current => ({ ...current, pages: board.pages, aiAnalysis: board.aiAnalysis }), { expectedUpdatedAt: board.updatedAt || null })
  board.updatedAt = saved.updatedAt
  return saved
}

export async function validateWhiteboardShares(context, values) {
  if (!Array.isArray(values) || values.length > 100 || values.some(value => typeof value !== 'string' || !value)) throw boardError('Invalid shared employees')
  const ids = [...new Set(values)].filter(value => value !== context.employeeId)
  const employees = await context.store.getMany('employees', ids)
  if (employees.filter(Boolean).length !== ids.length) throw boardError('A shared employee is not in this company', 404)
  return ids
}
