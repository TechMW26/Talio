import { handlePersonalTodo } from '@/lib/personalTodoApi.server'
export const dynamic = 'force-dynamic'
export const GET = (request, context) => handlePersonalTodo(request, context, 'todo')
export const PATCH = (request, context) => handlePersonalTodo(request, context, 'todo')
export const DELETE = (request, context) => handlePersonalTodo(request, context, 'todo')
