// Patch only records belonging to the changed employee; retain report/task data.
export function patchProfilePhotoResponse(response, employeeId, profilePicture, profilePictureViewport) {
  if (!response?.data || typeof response.data !== 'object' || !employeeId) return response
  const id = value => typeof value === 'object' && value ? value._id || value.id : value
  const patch = record => {
    if (!record || typeof record !== 'object') return record
    const matches = String(id(record)) === String(employeeId) || String(id(record.employeeId)) === String(employeeId)
    if (!matches) return record
    const photo = { profilePicture, ...(profilePictureViewport !== undefined ? { profilePictureViewport } : {}) }
    return { ...record, ...photo, ...(record.employeeId && typeof record.employeeId === 'object' ? { employeeId: { ...record.employeeId, ...photo } } : {}) }
  }
  const data = response.data
  if (Array.isArray(data)) return { ...response, data: data.map(patch) }
  const updated = patch(data)
  const nested = { ...updated }
  for (const key of ['employee', 'user']) if (data[key]) nested[key] = patch(data[key])
  for (const key of ['employees', 'teamMembers', 'members']) if (Array.isArray(data[key])) nested[key] = data[key].map(patch)
  return { ...response, data: nested }
}
