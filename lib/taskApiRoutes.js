export function getTaskApiBase(task) {
  const projectId = task?.project?._id || task?.project

  if (projectId) {
    return `/api/projects/${projectId}/tasks/${task._id}`
  }

  return `/api/tasks/${task._id}`
}

export function getTaskSubtasksApiBase(task) {
  return `${getTaskApiBase(task)}/subtasks`
}

export function getTaskSubtaskCommentsApiBase(task, subtaskId) {
  return `${getTaskSubtasksApiBase(task)}/${subtaskId}/comments`
}