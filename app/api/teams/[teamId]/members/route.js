import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { requirePermission } from '@/lib/permissions'

/**
 * GET /api/teams/[teamId]/members
 * List all members of a specific team
 */
export async function GET(request, context) {
    try {
        const { teamId } = await context.params
        const auth = await getAuthAndModels(request, ['Team', 'Employee'])
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 })
        }
        const { Team } = auth.models

        const team = await Team.findById(teamId)
            .populate({
                path: 'members',
                select: 'firstName lastName employeeCode email profilePicture department designation status',
                populate: [
                    { path: 'department', select: 'name code' },
                    { path: 'designation', select: 'title level' }
                ]
            })

        if (!team) {
            return NextResponse.json({ success: false, message: 'Team not found' }, { status: 404 })
        }

        return NextResponse.json({ success: true, data: team.members })
    } catch (error) {
        console.error('GET /api/teams/[teamId]/members error:', error)
        return NextResponse.json({ success: false, message: 'Failed to fetch team members' }, { status: 500 })
    }
}

/**
 * POST /api/teams/[teamId]/members
 * Add members to a team
 * Body: { employeeIds: [<employeeId>, ...] }
 */
export async function POST(request, context) {
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

        const team = await Team.findById(teamId)
        if (!team) {
            return NextResponse.json({ success: false, message: 'Team not found' }, { status: 404 })
        }

        // Prevent adding leaders as members in the same team
        const leaderSet = new Set(team.teamLeaders.map(String))
        const conflicts = employeeIds.filter(id => leaderSet.has(String(id)))
        if (conflicts.length > 0) {
            return NextResponse.json({
                success: false,
                message: 'Cannot add team leaders as members in the same team',
                conflictingIds: conflicts,
            }, { status: 400 })
        }

        await Team.findByIdAndUpdate(teamId, {
            $addToSet: { members: { $each: employeeIds } }
        })

        await User.updateMany(
            { employeeId: { $in: employeeIds } },
            { $addToSet: { teamMemberOf: teamId } }
        )

        return NextResponse.json({ success: true, message: 'Members added successfully' })
    } catch (error) {
        console.error('POST /api/teams/[teamId]/members error:', error)
        return NextResponse.json({ success: false, message: 'Failed to add members' }, { status: 500 })
    }
}

/**
 * DELETE /api/teams/[teamId]/members
 * Remove members from a team
 * Body: { employeeIds: [<employeeId>, ...] }
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
            $pull: { members: { $in: employeeIds } }
        })

        await User.updateMany(
            { employeeId: { $in: employeeIds } },
            { $pull: { teamMemberOf: teamId } }
        )

        return NextResponse.json({ success: true, message: 'Members removed successfully' })
    } catch (error) {
        console.error('DELETE /api/teams/[teamId]/members error:', error)
        return NextResponse.json({ success: false, message: 'Failed to remove members' }, { status: 500 })
    }
}
