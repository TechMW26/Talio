import { buildCacheKey, getCache, setCache } from '@/lib/cache'

const DIRECTORY_PROJECTION = 'firstName lastName employeeCode profilePicture avatar email designation designationLevel designationLevelName department status'

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function clampLimit(limit, fallback = 50) {
  const parsed = Number.parseInt(limit, 10)
  return Math.min(100, Math.max(1, Number.isFinite(parsed) ? parsed : fallback))
}

/**
 * Canonical employee/user directory query used by chat, participant pickers,
 * user search and lightweight employee selectors.
 */
export async function listDirectory({
  Employee,
  User,
  tenantId,
  currentUserId,
  query = '',
  limit = 50,
  includeAdmins = true,
  includeSelf = false,
}) {
  const normalizedQuery = String(query || '').trim().slice(0, 100)
  const safeLimit = clampLimit(limit)
  const cacheKey = buildCacheKey({
    tenantId,
    role: 'any',
    userId: currentUserId,
    namespace: 'directory:list',
    params: { normalizedQuery, safeLimit, includeAdmins, includeSelf },
  })
  const cached = await getCache(cacheKey)
  if (cached) return cached

  const currentUser = await User.findById(currentUserId).select('employeeId').lean()
  const employeeFilter = { status: 'active' }
  if (!includeSelf && currentUser?.employeeId) employeeFilter._id = { $ne: currentUser.employeeId }
  if (normalizedQuery) {
    const matcher = { $regex: escapeRegex(normalizedQuery), $options: 'i' }
    employeeFilter.$or = [
      { firstName: matcher },
      { lastName: matcher },
      { email: matcher },
      { employeeCode: matcher },
    ]
  }

  const employees = await Employee.find(employeeFilter)
    .select(DIRECTORY_PROJECTION)
    .populate({ path: 'designation', select: 'title levelName', options: { lean: true } })
    .populate({ path: 'department', select: 'name', options: { lean: true } })
    .sort({ firstName: 1, lastName: 1, _id: 1 })
    .limit(safeLimit)
    .lean()

  const employeeIds = employees.map((employee) => employee._id)
  const users = employeeIds.length
    ? await User.find({ employeeId: { $in: employeeIds }, isActive: true }).select('_id employeeId role email').lean()
    : []
  const usersByEmployee = new Map(users.map((user) => [String(user.employeeId), user]))

  const items = employees
    .map((employee) => {
      const linkedUser = usersByEmployee.get(String(employee._id))
      return {
        ...employee,
        userId: linkedUser?._id || null,
        role: linkedUser?.role || null,
        name: [employee.firstName, employee.lastName].filter(Boolean).join(' ') || employee.email,
        avatar: employee.profilePicture || employee.avatar || null,
      }
    })
    .filter((employee) => includeAdmins || employee.role !== 'admin')

  await setCache(cacheKey, items, 60)
  return items
}

export const directoryInternals = { escapeRegex, clampLimit }
