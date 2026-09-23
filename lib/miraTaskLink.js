export function miraTaskLink(task) {
  const id = String(task?.id || task?._id || '')
  if (!/^[a-f\d]{24}$/i.test(id)) return '/dashboard/projects/my-tasks'
  const project = String(task?.projectId || '')
  return /^[a-f\d]{24}$/i.test(project)
    ? `/dashboard/projects/${project}?task=${id}`
    : `/dashboard/projects/my-tasks?task=${id}`
}
