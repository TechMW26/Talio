import {
  GET as getProjectSubtaskComments,
  POST as postProjectSubtaskComment,
  DELETE as deleteProjectSubtaskComment
} from '@/app/api/projects/[projectId]/tasks/[taskId]/subtasks/[subtaskId]/comments/route'

export const dynamic = 'force-dynamic'

function buildContext(taskId, subtaskId) {
  return {
    params: {
      projectId: '_',
      taskId,
      subtaskId
    }
  }
}

export async function GET(request, { params }) {
  const { taskId, subtaskId } = await params
  return getProjectSubtaskComments(request, buildContext(taskId, subtaskId))
}

export async function POST(request, { params }) {
  const { taskId, subtaskId } = await params
  return postProjectSubtaskComment(request, buildContext(taskId, subtaskId))
}

export async function DELETE(request, { params }) {
  const { taskId, subtaskId } = await params
  return deleteProjectSubtaskComment(request, buildContext(taskId, subtaskId))
}