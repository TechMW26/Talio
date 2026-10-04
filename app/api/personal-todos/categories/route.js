import { handlePersonalTodo } from '@/lib/personalTodoApi.server'
export const dynamic = 'force-dynamic'
export const GET = (request, context) => handlePersonalTodo(request, context, 'categories')
export const POST = (request, context) => handlePersonalTodo(request, context, 'categories')
