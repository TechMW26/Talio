import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { requirePermission } from '@/lib/permissions'

/**
 * GET /api/teams/[teamId]/leaders
 * List all leaders of a specific team (with cross-department info)
 */
export async function GET(request, context) {
    try {
        const { teamId } = await context.params
        const auth = await getAuthAndModels(request, ['Team', 'Department', 'Employee'])
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 })
        }
        const { Team } = auth.models

        const team = await Team.findById(teamId)
            .populate({
                path: 'teamLeaders',
                select: 'firstName lastName employeeCode email profilePicture department designation',
                populate: { path: 'department', select: 'name code' }
            })
            .populate('department', 'name code')

        if (!team) {
            return NextResponse.json({ success: false, message: 'Team not found' }, { status: 404 })
        }

        // Annotate each leader with cross-department flag
        const leaders = team.teamLeaders.map(leader => {
            const leaderObj = leader.toObject ? leader.toObject() : leader
            const isCrossDepartment = leader.department && team.department &&
                leader.department._id.toString() !== team.department._id.toString()
            return { ...leaderObj, isCrossDepartment, teamDepartment: team.department }
        })

        return NextResponse.json({ success: true, data: leaders, team: { _id: team._id, teamName: team.teamName, department: team.department } })
    } catch (error) {
        console.error('GET /api/teams/[teamId]/leaders error:', error)
        return NextResponse.json({ success: false, message: 'Failed to fetch team leaders' }, { status: 500 })
    }
}

/**
 * POST /api/teams/[teamId]/leaders
 * Assign one or more users as team leaders (supports cross-department)
 * Body: { employeeIds: [<employeeId>, ...] }
 * Required roles: admin, hr, department_head, department_manager
 */
export async function POST(request, context) {
    try {
        const { teamId } = await context.params
        const result = await requirePermission('team_members', 'assign')(request, ['Team', 'Department', 'Employee', 'User'])
        if (result.denied) return result.denied
        const { user, models } = result
        const { Team, User } = models

        const { employeeIds } = await request.json()
        if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
            return NextResponse.json({ success: false, message: 'employeeIds array is required' }, { status: 400 })
        }

        const team = await Team.findById(teamId)
        if (!team) {
            return NextResponse.json({ success: false, message: 'Team not found' }, { status: 404 })
        }

        // Prevent assigning existing members as leaders in the same team
        const memberSet = new Set(team.members.map(String))
        const conflicts = employeeIds.filter(id => memberSet.has(String(id)))
        if (conflicts.length > 0) {
            return NextResponse.json({
                success: false,
                message: 'Cannot assign team members as leaders in the same team. Remove them as members first.',
                conflictingIds: conflicts,
            }, { status: 400 })
        }

        // Add leaders (avoid duplicates)
        await Team.findByIdAndUpdate(teamId, {
            $addToSet: { teamLeaders: { $each: employeeIds } }
        })

        // Sync User.teamLeaderOf
        await User.updateMany(
            { employeeId: { $in: employeeIds } },
            { $addToSet: { teamLeaderOf: teamId } }
        )

        const updated = await Team.findById(teamId)
            .populate({
                path: 'teamLeaders',
                select: 'firstName lastName employeeCode email department',
                populate: { path: 'department', select: 'name' }
            })

        return NextResponse.json({ success: true, data: updated.teamLeaders, message: 'Team leaders assigned successfully' })
    } catch (error) {
        console.error('POST /api/teams/[teamId]/leaders error:', error)
        return NextResponse.json({ success: false, message: 'Failed to assign team leaders' }, { status: 500 })
    }
}

/**
 * DELETE /api/teams/[teamId]/leaders
 * Remove one or more team leaders
 * Body: { employeeIds: [<employeeId>, ...] }
 * Required roles: admin, hr, department_head, department_manager
 */
export async function DELETE(request, context) {
    try {
        const { teamId } = await context.params
        const result = await requirePermission('team_members', 'assign')(request, ['Team', 'User'])
        if (result.denied) return result.denied
        const { user, models } = result
        const { Team, User } = models

        const { employeeIds } = await request.json()
        if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
            return NextResponse.json({ success: false, message: 'employeeIds array is required' }, { status: 400 })
        }

        await Team.findByIdAndUpdate(teamId, {
            $pull: { teamLeaders: { $in: employeeIds } }
        })

        // Remove from User.teamLeaderOf
        await User.updateMany(
            { employeeId: { $in: employeeIds } },
            { $pull: { teamLeaderOf: teamId } }
        )

        return NextResponse.json({ success: true, message: 'Team leaders removed successfully' })
    } catch (error) {
        console.error('DELETE /api/teams/[teamId]/leaders error:', error)
        return NextResponse.json({ success: false, message: 'Failed to remove team leaders' }, { status: 500 })
    }
}
