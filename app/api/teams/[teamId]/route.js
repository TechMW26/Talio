import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { requirePermission } from '@/lib/permissions'
import { buildCachePattern, clearCachePattern } from '@/lib/cache'

/**
 * GET /api/teams/[teamId]
 * Get a single team with full details
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
            .populate('department', 'name code head heads departmentManager departmentManagers')
            .populate('teamLeaders', 'firstName lastName employeeCode email profilePicture department designation')
            .populate('members', 'firstName lastName employeeCode email profilePicture department designation')
            .populate('createdBy', 'firstName lastName')

        if (!team) {
            return NextResponse.json({ success: false, message: 'Team not found' }, { status: 404 })
        }

        return NextResponse.json({ success: true, data: team })
    } catch (error) {
        console.error('GET /api/teams/[teamId] error:', error)
        return NextResponse.json({ success: false, message: 'Failed to fetch team' }, { status: 500 })
    }
}

/**
 * PUT /api/teams/[teamId]
 * Update a team (name, description, members, etc.)
 * Required roles: admin, hr, department_head, department_manager
 */
export async function PUT(request, context) {
    try {
        const { teamId } = await context.params
        const result = await requirePermission('team_members', 'edit')(request, ['Team', 'Department', 'Employee', 'User'])
        if (result.denied) return result.denied
        const { user, models, tenant } = result
        const { Team, Department, User } = models

        const team = await Team.findById(teamId)
        if (!team) {
            return NextResponse.json({ success: false, message: 'Team not found' }, { status: 404 })
        }

        const data = await request.json()

        // Validate no overlap between leaders and members
        const newLeaders = data.teamLeaders || team.teamLeaders.map(String)
        const newMembers = data.members || team.members.map(String)
        const leaderSet = new Set(newLeaders.map(String))
        const memberSet = new Set(newMembers.map(String))
        const overlap = [...leaderSet].filter(id => memberSet.has(id))
        if (overlap.length > 0) {
            return NextResponse.json({
                success: false,
                message: 'A user cannot be both a team leader and a member of the same team',
                conflictingIds: overlap,
            }, { status: 400 })
        }

        // Track old leaders/members for cleanup
        const oldLeaders = team.teamLeaders.map(String)
        const oldMembers = team.members.map(String)

        // Update allowed fields
        const allowedFields = ['teamName', 'description', 'teamLeaders', 'members', 'isActive']
        for (const field of allowedFields) {
            if (data[field] !== undefined) {
                team[field] = data[field]
            }
        }
        // teamCode can only be changed if provided and different
        if (data.teamCode && data.teamCode !== team.teamCode) {
            const exists = await Team.findOne({ teamCode: data.teamCode.trim(), _id: { $ne: teamId } })
            if (exists) {
                return NextResponse.json({ success: false, message: `Team code "${data.teamCode}" already exists` }, { status: 409 })
            }
            team.teamCode = data.teamCode.trim()
        }

        await team.save()

        // Sync user references - remove old, add new
        await syncTeamUserChanges(teamId, oldLeaders, team.teamLeaders.map(String), oldMembers, team.members.map(String), User)

        const populated = await Team.findById(teamId)
            .populate('department', 'name code')
            .populate('teamLeaders', 'firstName lastName employeeCode email department')
            .populate('members', 'firstName lastName employeeCode email department')

        // Bust departments cache so list reflects updated team data
        const bustPatternUpdate = buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'departments:list' })
        await clearCachePattern(bustPatternUpdate).catch(() => { })

        return NextResponse.json({ success: true, data: populated, message: 'Team updated successfully' })
    } catch (error) {
        console.error('PUT /api/teams/[teamId] error:', error)
        return NextResponse.json({ success: false, message: error.message || 'Failed to update team' }, { status: 500 })
    }
}

/**
 * DELETE /api/teams/[teamId]
 * Soft-delete a team (set isActive = false)
 * Required roles: admin, hr, department_head
 */
export async function DELETE(request, context) {
    try {
        const { teamId } = await context.params
        const result = await requirePermission('team_members', 'delete')(request, ['Team', 'Department', 'User'])
        if (result.denied) return result.denied
        const { user, models, tenant } = result
        const { Team, Department, User } = models

        const team = await Team.findById(teamId)
        if (!team) {
            return NextResponse.json({ success: false, message: 'Team not found' }, { status: 404 })
        }

        // Set inactive
        team.isActive = false
        await team.save()

        // Remove from department's teams array
        await Department.findByIdAndUpdate(team.department, { $pull: { teams: team._id } })

        // Remove team references from all users
        await User.updateMany(
            { teamLeaderOf: teamId },
            { $pull: { teamLeaderOf: teamId } }
        )
        await User.updateMany(
            { teamMemberOf: teamId },
            { $pull: { teamMemberOf: teamId } }
        )

        // Bust departments cache
        const bustPattern = buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'departments:list' })
        await clearCachePattern(bustPattern).catch(() => { })

        return NextResponse.json({ success: true, message: 'Team deleted successfully' })
    } catch (error) {
        console.error('DELETE /api/teams/[teamId] error:', error)
        return NextResponse.json({ success: false, message: 'Failed to delete team' }, { status: 500 })
    }
}

/**
 * Sync user teamLeaderOf / teamMemberOf when a team's leaders/members change
 */
async function syncTeamUserChanges(teamId, oldLeaders, newLeaders, oldMembers, newMembers, User) {
    // Leaders removed
    const removedLeaders = oldLeaders.filter(id => !newLeaders.includes(id))
    if (removedLeaders.length > 0) {
        await User.updateMany(
            { employeeId: { $in: removedLeaders } },
            { $pull: { teamLeaderOf: teamId } }
        )
    }
    // Leaders added
    const addedLeaders = newLeaders.filter(id => !oldLeaders.includes(id))
    if (addedLeaders.length > 0) {
        await User.updateMany(
            { employeeId: { $in: addedLeaders } },
            { $addToSet: { teamLeaderOf: teamId } }
        )
    }
    // Members removed
    const removedMembers = oldMembers.filter(id => !newMembers.includes(id))
    if (removedMembers.length > 0) {
        await User.updateMany(
            { employeeId: { $in: removedMembers } },
            { $pull: { teamMemberOf: teamId } }
        )
    }
    // Members added
    const addedMembers = newMembers.filter(id => !oldMembers.includes(id))
    if (addedMembers.length > 0) {
        await User.updateMany(
            { employeeId: { $in: addedMembers } },
            { $addToSet: { teamMemberOf: teamId } }
        )
    }
}
