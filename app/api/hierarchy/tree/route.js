import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { LEVEL_NAMES, inferLevelFromTitle } from '@/lib/designationLevels'

export const dynamic = 'force-dynamic'

function rawTitle(emp) {
  const d = emp.designation
  if (!d) return emp.designationLevelName || ''
  if (typeof d === 'string') return d
  const t = d.title || d.name
  if (typeof t === 'object' && t) return t.name || t.title || ''
  return t || emp.designationLevelName || ''
}

function levelOf(emp) {
  const fromEmp = Number(emp.designationLevel || 0)
  const fromDesig = Number(emp.designation?.level || 0)
  const stored = fromEmp || fromDesig
  if (stored >= 1 && stored <= 9) return stored
  // Fallback: infer from title
  return inferLevelFromTitle(rawTitle(emp))
}

function isHrText(value) {
  const t = String(value || '').trim().toLowerCase()
  if (!t) return false
  return /(human\s*resource|people\s*operations|people\s*&?\s*culture|talent\s*management|^hr$|\bhr\b|hrbp|hr\s*ops)/.test(t)
}

export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, ['Employee', 'User', 'Department', 'Team'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const { Employee, User, Team } = auth.models
    const viewerUserId = String(auth.user?._id || auth.user?.userId || '')

    const employees = await Employee.find({ status: { $ne: 'terminated' } })
      .populate('designation', 'title level levelName')
      .populate('department', 'name')
      .select('firstName lastName profilePicture bio designation designationLevel designationLevelName reportingManager assignedManager assignedTeamLead reportsTo department status dateOfJoining dateOfBirth')
      .lean()

    if (!employees.length) {
      return NextResponse.json({ success: true, data: { roots: [], totalEmployees: 0, viewerEmployeeId: null } })
    }

    const users = await User.find({ employeeId: { $in: employees.map((e) => e._id) } })
      .select('_id employeeId isDepartmentHead headOfDepartments isDepartmentManager departmentManagerOf teamLeaderOf teamMemberOf')
      .lean()

    const teams = await Team.find({ isActive: { $ne: false } })
      .select('_id name department teamLeaders members')
      .lean()
      .catch(() => [])

    const employeesById = new Map(employees.map((e) => [String(e._id), e]))
    const userByEmployeeId = new Map(users.map((u) => [String(u.employeeId), u]))

    let viewerEmployeeId = null
    const viewerUser = users.find((u) => String(u._id) === viewerUserId)
    if (viewerUser?.employeeId) viewerEmployeeId = String(viewerUser.employeeId)
    if (!viewerEmployeeId && auth.user?.employeeId) {
      const eid = auth.user.employeeId
      viewerEmployeeId = typeof eid === 'object' ? String(eid._id || eid.id || '') : String(eid)
    }

    // Department index
    const deptToMembers = new Map()
    const deptName = new Map()
    for (const emp of employees) {
      const dId = emp.department ? String(emp.department._id || emp.department) : '__none__'
      if (!deptToMembers.has(dId)) deptToMembers.set(dId, [])
      deptToMembers.get(dId).push(String(emp._id))
      if (emp.department?.name) deptName.set(dId, emp.department.name)
    }

    // Team index
    const teamMap = new Map()
    for (const t of teams) {
      teamMap.set(String(t._id), {
        department: t.department ? String(t.department) : null,
        leaders: (t.teamLeaders || []).map(String),
        members: (t.members || []).map(String),
      })
    }

    // Compute & cache level per employee
    const levelById = new Map()
    employees.forEach((e) => levelById.set(String(e._id), levelOf(e)))

    // Department head pick (highest level + isDepartmentHead flag tiebreaker)
    const deptToHead = new Map()
    for (const [dId, mids] of deptToMembers.entries()) {
      let head = null
      let bestScore = -1
      for (const mid of mids) {
        const u = userByEmployeeId.get(mid)
        const isFlagged =
          (u?.isDepartmentHead && (u?.headOfDepartments || []).map(String).includes(dId)) ||
          (u?.isDepartmentManager && (u?.departmentManagerOf || []).map(String).includes(dId))
        const lvl = levelById.get(mid) || 0
        const score = (isFlagged ? 1000 : 0) + lvl
        if (score > bestScore) {
          bestScore = score
          head = mid
        }
      }
      if (head) deptToHead.set(dId, head)
    }

    // Parent resolution strictly uses, in order:
    //   1. assignedManager
    //   2. assignedTeamLead
    //   3. reportsTo (executive reporting chain)
    //   4. department head -> department members (only when emp is not the head)
    // No inferred reporting chains, no team-leader inference, no "closest superior" fallback.
    const parentOf = new Map()
    for (const emp of employees) {
      const empId = String(emp._id)
      const dId = emp.department ? String(emp.department._id || emp.department) : null
      let parent = null

      const assignedManagerId = emp.assignedManager ? String(emp.assignedManager) : null
      if (assignedManagerId && assignedManagerId !== empId && employeesById.has(assignedManagerId)) {
        parent = assignedManagerId
      }

      if (!parent) {
        const assignedLeadId = emp.assignedTeamLead ? String(emp.assignedTeamLead) : null
        if (assignedLeadId && assignedLeadId !== empId && employeesById.has(assignedLeadId)) {
          parent = assignedLeadId
        }
      }

      if (!parent) {
        const reportsToId = emp.reportsTo ? String(emp.reportsTo) : null
        if (reportsToId && reportsToId !== empId && employeesById.has(reportsToId)) {
          parent = reportsToId
        }
      }

      if (!parent && dId) {
        const headId = deptToHead.get(dId)
        if (headId && headId !== empId && employeesById.has(headId)) {
          parent = headId
        }
      }

      parentOf.set(empId, parent)
    }

    // Cycle protection
    function hasCycle(start) {
      let cur = start
      const seen = new Set()
      while (cur) {
        if (seen.has(cur)) return true
        seen.add(cur)
        cur = parentOf.get(cur)
      }
      return false
    }
    for (const empId of parentOf.keys()) if (hasCycle(empId)) parentOf.set(empId, null)

    // Build nodes
    const nodes = new Map()
    for (const emp of employees) {
      const empId = String(emp._id)
      const u = userByEmployeeId.get(empId)
      const dId = emp.department ? String(emp.department._id || emp.department) : null
      const isHead = dId && deptToHead.get(dId) === empId
      const lvl = levelById.get(empId) || 1
      const deptLabel = emp.department?.name || (dId && deptName.get(dId)) || null
      const titleLabel = rawTitle(emp) || ''
      nodes.set(empId, {
        id: empId,
        name: `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || 'Unnamed',
        designation: titleLabel || 'No designation',
        level: lvl,
        levelName: LEVEL_NAMES[lvl] || `Level ${lvl}`,
        dateOfJoining: emp.dateOfJoining || null,
        dateOfBirth: emp.dateOfBirth || null,
        profilePicture: emp.profilePicture || null,
        bio: emp.bio || '',
        status: emp.status || 'active',
        department: deptLabel,
        departmentId: dId,
        isDepartmentHead: !!isHead || !!u?.isDepartmentHead,
        isHR: isHrText(deptLabel) || isHrText(titleLabel),
        isViewer: empId === viewerEmployeeId,
        children: [],
      })
    }

    const roots = []
    for (const [empId, parent] of parentOf.entries()) {
      const node = nodes.get(empId)
      if (!node) continue
      if (parent && nodes.has(parent)) nodes.get(parent).children.push(node)
      else roots.push(node)
    }

    function sortRecursive(list) {
      list.sort((a, b) => b.level - a.level || a.name.localeCompare(b.name))
      list.forEach((n) => sortRecursive(n.children))
    }
    sortRecursive(roots)

    return NextResponse.json({
      success: true,
      data: { roots, totalEmployees: employees.length, viewerEmployeeId },
    })
  } catch (error) {
    console.error('Hierarchy tree error:', error)
    return NextResponse.json({ success: false, message: error.message || 'Failed to load hierarchy tree' }, { status: 500 })
  }
}
