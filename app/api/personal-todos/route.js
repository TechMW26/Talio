import { handlePersonalTodo } from '@/lib/personalTodoApi.server'
export const dynamic = 'force-dynamic'
export const GET = (request, context) => handlePersonalTodo(request, context, 'todos')
export const POST = (request, context) => handlePersonalTodo(request, context, 'todos')
