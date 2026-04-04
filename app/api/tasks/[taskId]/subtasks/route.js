import {
  GET as getProjectSubtasks,
  POST as postProjectSubtask,
  PUT as putProjectSubtask,
  DELETE as deleteProjectSubtask
} from '@/app/api/projects/[projectId]/tasks/[taskId]/subtasks/route'

export const dynamic = 'force-dynamic'

function buildContext(taskId) {
  return {
    params: {
      projectId: '_',
      taskId
    }
  }
}

export async function GET(request, { params }) {
  const { taskId } = await params
  return getProjectSubtasks(request, buildContext(taskId))
}

export async function POST(request, { params }) {
  const { taskId } = await params
  return postProjectSubtask(request, buildContext(taskId))
}

export async function PUT(request, { params }) {
  const { taskId } = await params
  return putProjectSubtask(request, buildContext(taskId))
}

export async function DELETE(request, { params }) {
  const { taskId } = await params
  return deleteProjectSubtask(request, buildContext(taskId))
}