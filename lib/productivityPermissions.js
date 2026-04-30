/**
 * Permission helpers for productivity / screenshot data.
 * Centralized so multiple routes (list, daily analyzer, etc.) share identical
 * access rules.
 */

/**
 * @param {string|object} viewerId
 * @param {string|object} targetUserId
 * @param {string} viewerRole
 * @param {{User: any, Employee: any, Department: any}} models
 */
export async function canViewUserScreenshots(viewerId, targetUserId, viewerRole, models) {
  const { User, Employee, Department } = models;

  if (['admin', 'hr'].includes(viewerRole)) {
    return true;
  }

  if (viewerId?.toString() === targetUserId?.toString()) {
    return true;
  }

  const viewer = await User.findById(viewerId).select('employeeId');
  const target = await User.findById(targetUserId).select('employeeId');

  if (!viewer?.employeeId || !target?.employeeId) {
    return false;
  }

  const viewerEmployee = await Employee.findById(viewer.employeeId).select('_id');
  const targetEmployee = await Employee.findById(target.employeeId).select('department departments');

  if (!viewerEmployee || !targetEmployee) {
    return false;
  }

  const targetDepartments = [];
  if (targetEmployee.department) targetDepartments.push(targetEmployee.department);
  if (targetEmployee.departments?.length) targetDepartments.push(...targetEmployee.departments);

  if (targetDepartments.length === 0) return false;

  const departments = await Department.find({
    _id: { $in: targetDepartments },
    $or: [{ head: viewerEmployee._id }, { heads: viewerEmployee._id }],
  }).select('_id');

  return departments.length > 0;
}
