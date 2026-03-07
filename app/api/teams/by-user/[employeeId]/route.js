import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

/**
 * GET /api/teams/by-user/[employeeId]
 * List all teams a user is leading and all teams they are a member of.
 * Includes cross-department details.
 * 
 * Response: {
 *   leading: [{ team, isCrossDepartment, homeDepartment, teamDepartment }],
 *   memberOf: [{ team }],
 *   summary: { teamsLeading, teamsMemberOf, departmentsLeadingAcross }
 * }
 */
export async function GET(request, context) {
    try {
        const { employeeId } = await context.params
        const auth = await getAuthAndModels(request, ['Team', 'Employee', 'Department'])
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 })
        }
        const { Team, Employee } = auth.models

        // Get the employee's home department
        const employee = await Employee.findById(employeeId)
            .select('firstName lastName department employeeCode')
            .populate('department', 'name code')

        if (!employee) {
            return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
        }

        // Find all teams where this employee is a leader
        const teamsLeading = await Team.find({ teamLeaders: employeeId, isActive: true })
            .populate('department', 'name code')
            .populate('members', 'firstName lastName employeeCode')
            .select('teamName teamCode department members')

        // Find all teams where this employee is a member
        const teamsMemberOf = await Team.find({ members: employeeId, isActive: true })
            .populate('department', 'name code')
            .populate('teamLeaders', 'firstName lastName employeeCode')
            .select('teamName teamCode department teamLeaders')

        const homeDeptId = employee.department?._id?.toString()

        const leading = teamsLeading.map(t => ({
            ...t.toObject(),
            isCrossDepartment: homeDeptId && t.department?._id?.toString() !== homeDeptId,
            homeDepartment: employee.department,
        }))

        // Count unique departments the user leads teams across
        const uniqueDepts = new Set(teamsLeading.map(t => t.department?._id?.toString()).filter(Boolean))

        return NextResponse.json({
            success: true,
            data: {
                employee: { _id: employee._id, firstName: employee.firstName, lastName: employee.lastName, employeeCode: employee.employeeCode, department: employee.department },
                leading,
                memberOf: teamsMemberOf,
                summary: {
                    teamsLeading: teamsLeading.length,
                    teamsMemberOf: teamsMemberOf.length,
                    departmentsLeadingAcross: uniqueDepts.size,
                }
            }
        })
    } catch (error) {
        console.error('GET /api/teams/by-user/[employeeId] error:', error)
        return NextResponse.json({ success: false, message: 'Failed to fetch user teams' }, { status: 500 })
    }
}
