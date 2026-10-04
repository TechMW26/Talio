import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from './auth'
import { TODO_STORE_OPTIONS, listOwnedTodos, listTodoCategories, filterTodoList, ownedTodoRecord, populateTodos, mutateTodo, mutateTodoCategory } from './personalTodos.server'
import { personalTodoAnalytics } from './personalTodoAnalytics'

export async function handlePersonalTodo(request, context = {}, kind = 'todos') {
  try {
    const auth = await getAuthAndDatabase(request, TODO_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const { database, user } = auth, userId = String(user._id), { id } = await context.params || {}, params = new URL(request.url).searchParams
    let data
    if (request.method === 'GET') {
      if (kind === 'todos') {
        const result = filterTodoList(await listOwnedTodos(database, userId), params)
        return NextResponse.json({ success: true, data: await populateTodos(database, result.records, userId), pagination: result.pagination, counts: result.counts })
      }
      if (kind === 'todo') data = (await populateTodos(database, [await ownedTodoRecord(database, 'personaltodos', userId, id)], userId))[0]
      if (kind === 'categories') data = await listTodoCategories(database, userId)
      if (kind === 'category') {
        const category = await ownedTodoRecord(database, 'todocategories', userId, id)
        data = { ...category, todoCount: (await listOwnedTodos(database, userId)).filter(row => row.category === id).length }
      }
      if (kind === 'analytics') data = personalTodoAnalytics(await listOwnedTodos(database, userId), await listTodoCategories(database, userId), params)
    } else {
      const body = ['DELETE'].includes(request.method) || kind === 'complete' ? {} : await request.json()
      if (kind === 'categories' || kind === 'category') data = await mutateTodoCategory(database, user, id, body, request.method === 'DELETE')
      else {
        const op = kind === 'subtasks' ? `subtask-${({ POST: 'create', PATCH: 'update', DELETE: 'delete' })[request.method]}` : kind === 'complete' ? 'complete' : ({ POST: 'create', PATCH: 'update', DELETE: 'delete' })[request.method]
        if (kind === 'subtasks' && request.method === 'DELETE') body.subtaskId = params.get('subtaskId')
        data = (await populateTodos(database, [await mutateTodo(database, user, id, op, body)], userId))[0]
      }
    }
    return NextResponse.json({ success: true, data, ...(request.method !== 'GET' ? { message: request.method === 'DELETE' ? 'Item deleted successfully' : 'Saved successfully' } : {}) }, { status: request.method === 'POST' && ['todos', 'categories'].includes(kind) ? 201 : 200 })
  } catch (error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'Unable to process personal todo' }, { status: error.status || 500 }) }
}
