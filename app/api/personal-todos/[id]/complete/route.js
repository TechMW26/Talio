import { handlePersonalTodo } from '@/lib/personalTodoApi.server'
export const dynamic = 'force-dynamic'
export const PATCH = (request, context) => handlePersonalTodo(request, context, 'complete')
