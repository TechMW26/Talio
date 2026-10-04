import { handlePersonalTodo } from '@/lib/personalTodoApi.server'
export const dynamic = 'force-dynamic'
export const POST = (request, context) => handlePersonalTodo(request, context, 'subtasks')
export const PATCH = (request, context) => handlePersonalTodo(request, context, 'subtasks')
export const DELETE = (request, context) => handlePersonalTodo(request, context, 'subtasks')
