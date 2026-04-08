export async function resolveMeetingEmployee(models, user) {
  const { Employee, User } = models
  const userId = user?._id || user?.userId

  const userRecord = await User.findById(userId).select('employeeId').lean()

  if (userRecord?.employeeId) {
    const employee = await Employee.findById(userRecord.employeeId).lean()
    if (employee) {
      return employee
    }
  }

  return Employee.findOne({ userId }).lean()
}