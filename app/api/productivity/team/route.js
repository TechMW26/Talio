import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import { buildDirectReportsFilter } from '@/lib/teamScope';
import mongoose from 'mongoose';

/**
 * GET /api/productivity/team
 * Returns team members with their per-day screenshot/analysis summary.
 * Pure raw-screenshot model — no ProductivitySession dependency.
 */
export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, ['User', 'Employee', 'Department', 'Screenshot', 'ScreenshotAnalysis', 'Team']);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }
    const { user, models } = auth;
    const { User, Employee, Department, Screenshot, ScreenshotAnalysis, Team } = models;

    const currentUserId = (user._id || user.userId).toString();
    const currentUserRole = user.role;

    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date') || new Date().toISOString().split('T')[0];
    const departmentFilter = searchParams.get('department');
    const teamFilter = searchParams.get('team');

    // Get current user with employee info
    const currentUser = await User.findById(currentUserId)
      .select('role employeeId isDepartmentHead headOfDepartments isDepartmentManager departmentManagerOf teamLeaderOf')
      .populate('employeeId');

    const isAdminOrHR = ['admin', 'hr'].includes(currentUserRole);

    let teamMembers = [];
    let departmentName = null;
    let departments = [];

    if (isAdminOrHR) {
      // Admin/HR can see all employees, optionally filtered by department
      let employeeQuery = { status: 'active' };

      // Apply department filter if specified
      if (departmentFilter && departmentFilter !== 'all') {
        employeeQuery.department = departmentFilter;
        const dept = await Department.findById(departmentFilter).lean();
        departmentName = dept?.name || 'Filtered Department';
      } else {
        departmentName = 'All Departments';
      }

      const employees = await Employee.find(employeeQuery)
        .select('firstName lastName email profilePicture department designation userId')
        .populate('department', 'name')
        .populate('designation', 'title')
        .lean();

      // Filter only employees with userId
      teamMembers = employees.filter(e => e.userId).map(e => ({
        ...e,
        user: e.userId // Map userId to user for consistency
      }));

      console.log(`[Team API] Admin/HR viewing ${teamMembers.length} employees from ${departmentName}`);
    } else {
      // Check if user is department head - support multiple departments
      const currentEmployeeId = currentUser?.employeeId?._id;

      if (!currentEmployeeId) {
        return NextResponse.json({
          success: true,
          data: [],
          message: 'No employee profile linked'
        });
      }

      let departmentIds = [];

      // First check User.headOfDepartments (supports multiple departments)
      if (currentUser?.isDepartmentHead && currentUser?.headOfDepartments?.length > 0) {
        departmentIds = currentUser.headOfDepartments.map(d => d.toString());
        departments = await Department.find({ _id: { $in: departmentIds }, isActive: true }).lean();
      }

      // Fallback: Check Department.head or Department.heads
      if (departmentIds.length === 0) {
        departments = await Department.find({
          $or: [
            { head: currentEmployeeId },
            { heads: currentEmployeeId }
          ],
          isActive: true
        }).lean();
        departmentIds = departments.map(d => d._id.toString());
      }

      // If not a department head, check if user is a team leader
      if (departmentIds.length === 0) {
        const teamLeaderUser = await User.findById(currentUserId)
          .select('teamLeaderOf')
          .lean();

        if (teamLeaderUser?.teamLeaderOf?.length > 0) {
          // Get teams this user leads
          const ledTeams = await Team.find({
            _id: { $in: teamLeaderUser.teamLeaderOf },
            isActive: true
          }).select('teamName members teamLeaders').lean();

          if (ledTeams.length > 0) {
            // Collect all team member + leader employee IDs
            const teamEmployeeIds = new Set();
            for (const team of ledTeams) {
              for (const m of (team.members || [])) teamEmployeeIds.add(m.toString());
              for (const l of (team.teamLeaders || [])) teamEmployeeIds.add(l.toString());
            }

            const employees = await Employee.find({
              _id: { $in: [...teamEmployeeIds] },
              status: 'active'
            })
              .select('firstName lastName email profilePicture department designation userId')
              .populate('department', 'name')
              .populate('designation', 'title')
              .lean();

            teamMembers = employees.filter(e => e.userId).map(e => ({
              ...e,
              user: e.userId
            }));

            departmentName = ledTeams.map(t => t.teamName).join(', ');
            console.log(`[Team API] Team leader viewing ${teamMembers.length} members from ${ledTeams.length} team(s)`);
          }
        }
      }

      // Assignment-based visibility: explicit manager / team lead / reportsTo / reportingManager mapping (cross-department).
      const assignmentFilter = buildDirectReportsFilter(currentEmployeeId, { status: 'active' });
      const assignmentMembers = assignmentFilter
        ? await Employee.find(assignmentFilter)
          .select('firstName lastName email profilePicture department designation userId assignedManager assignedTeamLead reportsTo reportingManager')
          .populate('department', 'name')
          .populate('designation', 'title')
          .lean()
        : [];

      if (assignmentMembers.length > 0) {
        const assignmentNormalized = assignmentMembers.filter(e => e.userId).map(e => ({ ...e, user: e.userId }));
        const seen = new Set(teamMembers.map((m) => m._id.toString()));
        for (const m of assignmentNormalized) {
          if (!seen.has(m._id.toString())) {
            seen.add(m._id.toString());
            teamMembers.push(m);
          }
        }
      }

      if (departmentIds.length === 0 && teamMembers.length === 0) {
        return NextResponse.json({
          success: true,
          data: [],
          departments: [],
          message: 'You are not a department head, team leader, or mapped manager'
        });
      }

      // Department head flow: filter by department
      if (departmentIds.length > 0) {
        // Apply department filter if specified and user is authorized for that department
        if (departmentFilter && departmentFilter !== 'all') {
          if (departmentIds.includes(departmentFilter)) {
            departmentIds = [departmentFilter];
            const filteredDept = departments.find(d => d._id.toString() === departmentFilter);
            departmentName = filteredDept?.name || 'Filtered Department';
          } else {
            return NextResponse.json({
              success: false,
              message: 'Not authorized to view this department'
            }, { status: 403 });
          }
        } else {
          departmentName = departments.length > 1
            ? departments.map(d => d.name).join(', ')
            : departments[0]?.name || 'Department';
        }

        // Get all employees in filtered/all departments user heads
        const employees = await Employee.find({
          status: 'active',
          $or: [
            { department: { $in: departmentIds } },
            { departments: { $in: departmentIds } }
          ]
        })
          .select('firstName lastName email profilePicture department designation userId')
          .populate('department', 'name')
          .populate('designation', 'title')
          .lean();

        console.log(`[Team API] Found ${employees.length} employees in department(s) ${departmentName}`);

        // Filter only employees with userId and map for consistency
        teamMembers = employees.filter(e => e.userId).map(e => ({
          ...e,
          user: e.userId // Map userId to user for consistency
        }));

        console.log(`[Team API] ${teamMembers.length} employees have userId linked`);
      }
      // Team leader flow: teamMembers already populated above
    }

    // Apply team filter if specified
    if (teamFilter && teamFilter !== 'all' && Team) {
      const team = await Team.findById(teamFilter).select('members teamLeaders').lean();
      if (team) {
        const teamMemberIds = new Set([
          ...(team.members || []).map(id => id.toString()),
          ...(team.teamLeaders || []).map(id => id.toString())
        ]);
        teamMembers = teamMembers.filter(m => teamMemberIds.has(m._id.toString()));
      }
    }

    // === Aggregate per-user screenshot counts and analysis for the date ===
    const allUserIds = teamMembers
      .map((m) => (m.user._id || m.user)?.toString())
      .filter(Boolean);

    // Per-user counts (total + analyzed) using $facet via aggregation pipeline
    const screenshotCounts = allUserIds.length > 0
      ? await Screenshot.aggregate([
          { $match: { user: { $in: allUserIds.map((id) => {
            try { return new mongoose.Types.ObjectId(id); } catch { return id; }
          }) }, dateString: dateParam } },
          {
            $group: {
              _id: '$user',
              total: { $sum: 1 },
              analyzed: { $sum: { $cond: [{ $eq: ['$analyzed', true] }, 1, 0] } },
              latestAt: { $max: '$capturedAt' },
            },
          },
        ])
      : [];

    const countsByUser = new Map();
    for (const row of screenshotCounts) {
      countsByUser.set(row._id.toString(), {
        total: row.total || 0,
        analyzed: row.analyzed || 0,
        pending: Math.max(0, (row.total || 0) - (row.analyzed || 0)),
        latestAt: row.latestAt || null,
      });
    }

    // Per-user analysis (one doc per user/day)
    const analyses = allUserIds.length > 0
      ? await ScreenshotAnalysis.find({ user: { $in: allUserIds }, dateString: dateParam })
          .select('user aiAnalysis lastAnalyzedAt summary')
          .lean()
      : [];
    const analysisByUser = new Map();
    for (const doc of analyses) {
      analysisByUser.set(doc.user.toString(), doc);
    }

    const teamWithStats = teamMembers.map((member) => {
      const userId = (member.user._id || member.user).toString();
      const counts = countsByUser.get(userId) || { total: 0, analyzed: 0, pending: 0, latestAt: null };
      const analysisDoc = analysisByUser.get(userId);
      const aiAnalysis = analysisDoc?.aiAnalysis || null;

      return {
        _id: member._id,
        firstName: member.firstName,
        lastName: member.lastName,
        email: member.email,
        profilePicture: member.profilePicture,
        department: member.department?.name || 'N/A',
        designation: member.designation?.title || 'N/A',
        userId,
        dailyStats: {
          totalCaptures: counts.total,
          analyzedCaptures: counts.analyzed,
          pendingCaptures: counts.pending,
          score: aiAnalysis?.score ?? null,
          focusScore: aiAnalysis?.focusScore ?? null,
          lastAnalyzedAt: analysisDoc?.lastAnalyzedAt || null,
          summary: aiAnalysis?.summary || analysisDoc?.summary || null,
          latestCaptureAt: counts.latestAt,
        },
      };
    });

    // Sort: highest score first, then most captures
    teamWithStats.sort((a, b) => {
      const sa = a.dailyStats.score;
      const sb = b.dailyStats.score;
      if (sa != null && sb != null) return sb - sa;
      if (sa != null) return -1;
      if (sb != null) return 1;
      return b.dailyStats.totalCaptures - a.dailyStats.totalCaptures;
    });

    let availableDepartments = [];
    if (!isAdminOrHR && departments && departments.length > 1) {
      availableDepartments = departments.map((d) => ({ _id: d._id, name: d.name, code: d.code }));
    }

    return NextResponse.json({
      success: true,
      data: teamWithStats,
      date: dateParam,
      department: departmentName,
      departments: availableDepartments,
      totalMembers: teamWithStats.length,
    });

  } catch (error) {
    console.error('Get team sessions error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get team sessions', details: error.message },
      { status: 500 }
    );
  }
}
