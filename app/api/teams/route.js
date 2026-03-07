import { NextResponse } from 'next/server'
import { getAuthAndModels, hasRole } from '@/lib/auth'
import { buildCachePattern, clearCachePattern } from '@/lib/cache'

/**
 * GET /api/teams
 * List all teams. Supports filtering by department.
 * Query params: ?department=<id>&includeInactive=true
 */
export async function GET(request) {
    try {
        const auth = await getAuthAndModels(request, ['Team', 'Department', 'Employee'])
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 })
        }
        const { models } = auth
        const { Team } = models

        const { searchParams } = new URL(request.url)
        const departmentId = searchParams.get('department')
        const includeInactive = searchParams.get('includeInactive') === 'true'

        const query = {}
        if (departmentId) query.department = departmentId
        if (!includeInactive) query.isActive = true

        const teams = await Team.find(query)
            .populate('department', 'name code')
            .populate('teamLeaders', 'firstName lastName employeeCode email profilePicture department')
            .populate('members', 'firstName lastName employeeCode email profilePicture department')
            .populate('createdBy', 'firstName lastName')
            .sort({ teamName: 1 })

        return NextResponse.json({ success: true, data: teams })
    } catch (error) {
        console.error('GET /api/teams error:', error)
        return NextResponse.json({ success: false, message: 'Failed to fetch teams' }, { status: 500 })
    }
}

/**
 * POST /api/teams
 * Create a new team inside a department.
 * Required roles: admin, hr, department_head, department_manager
 * Body: { teamName, teamCode, description?, department, teamLeaders?[], members?[] }
 */
export async function POST(request) {
    try {
        const auth = await getAuthAndModels(request, ['Team', 'Department', 'Employee', 'User'])
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 })
        }
        const { user, models } = auth
        const { Team, Department, User } = models

        // Role check — admin, hr, department_head, department_manager
        if (!hasRole(user, ['admin', 'hr', 'department_head', 'department_manager'])) {
            return NextResponse.json({ success: false, message: 'Insufficient permissions' }, { status: 403 })
        }

        const data = await request.json()
        const { teamName, teamCode, description, department: deptId, teamLeaders = [], members = [] } = data

        if (!teamName || !teamCode || !deptId) {
            return NextResponse.json({ success: false, message: 'teamName, teamCode, and department are required' }, { status: 400 })
        }

        // Verify department exists
        const dept = await Department.findById(deptId)
        if (!dept) {
            return NextResponse.json({ success: false, message: 'Department not found' }, { status: 404 })
        }

        // Check for duplicate teamCode
        const existing = await Team.findOne({ teamCode: teamCode.trim() })
        if (existing) {
            return NextResponse.json({ success: false, message: `Team code "${teamCode}" already exists` }, { status: 409 })
        }

        // Validate: a member cannot also be a leader in the same team
        const leaderSet = new Set(teamLeaders.map(String))
        const memberSet = new Set(members.map(String))
        const overlap = [...leaderSet].filter(id => memberSet.has(id))
        if (overlap.length > 0) {
            return NextResponse.json({
                success: false,
                message: 'A user cannot be both a team leader and a member of the same team',
                conflictingIds: overlap,
            }, { status: 400 })
        }

        const employeeId = user.employeeId?._id || user.employeeId

        const team = await Team.create({
            teamName: teamName.trim(),
            teamCode: teamCode.trim(),
            description: description?.trim(),
            department: deptId,
            teamLeaders,
            members,
            createdBy: employeeId,
        })

        // Add team reference to the department
        await Department.findByIdAndUpdate(deptId, { $addToSet: { teams: team._id } })

        // Update User records for team leaders and members
        await syncTeamToUsers(team, User)

        // Bust departments cache so the list shows updated teams
        const bustPattern = buildCachePattern({ tenantId: auth.tenant?.databaseName, namespace: 'departments:list' })
        await clearCachePattern(bustPattern).catch(() => { })

        const populated = await Team.findById(team._id)
            .populate('department', 'name code')
            .populate('teamLeaders', 'firstName lastName employeeCode email department')
            .populate('members', 'firstName lastName employeeCode email department')

        return NextResponse.json({ success: true, data: populated, message: 'Team created successfully' }, { status: 201 })
    } catch (error) {
        console.error('POST /api/teams error:', error)
        return NextResponse.json({ success: false, message: error.message || 'Failed to create team' }, { status: 500 })
    }
}

/**
 * Sync team leader/member references back to User documents
 */
async function syncTeamToUsers(team, User) {
    const teamId = team._id

    // Add teamLeaderOf for all leaders
    if (team.teamLeaders?.length > 0) {
        // Find users by employeeId
        await User.updateMany(
            { employeeId: { $in: team.teamLeaders } },
            { $addToSet: { teamLeaderOf: teamId } }
        )
    }

    // Add teamMemberOf for all members
    if (team.members?.length > 0) {
        await User.updateMany(
            { employeeId: { $in: team.members } },
            { $addToSet: { teamMemberOf: teamId } }
        )
    }
}
