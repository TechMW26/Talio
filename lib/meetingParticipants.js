export async function resolveMeetingEmployee(database, user) {
  const userId = user?._id || user?.userId

  const userRecord = await database.get('users', String(userId))

  if (userRecord?.employeeId) {
    const employee = await database.get('employees', String(userRecord.employeeId?._id || userRecord.employeeId))
    if (employee) {
      return employee
    }
  }

  return (await database.list('employees', { filters: [{ field: 'userId', operator: '==', value: String(userId) }], limit: 1 })).records[0] || null
}
