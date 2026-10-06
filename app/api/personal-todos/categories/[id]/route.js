import { handlePersonalTodo } from '@/lib/personalTodoApi.server'
export const dynamic = 'force-dynamic'
export const GET = (request, context) => handlePersonalTodo(request, context, 'category')
export const PATCH = (request, context) => handlePersonalTodo(request, context, 'category')
export const DELETE = (request, context) => handlePersonalTodo(request, context, 'category')
