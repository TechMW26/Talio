import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';

const SCREENSHOTS_PER_SESSION_ESTIMATE = 20; // ~20 screenshots per 60-min session at 3-min intervals

/**
 * GET /api/productivity/team
 * Get team members with their session summaries for department heads and admins
 */
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['ProductivitySession', 'User', 'Employee', 'Department', 'Screenshot', 'Team']);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }
    const { user, models } = auth;
    const { ProductivitySession, User, Employee, Department, Screenshot, Team } = models;

    const currentUserId = (user._id || user.userId).toString();
    const currentUserRole = user.role;
    
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date') || new Date().toISOString().split('T')[0];
    const departmentFilter = searchParams.get('department'); // Department filter for admin/HR
    const teamFilter = searchParams.get('team'); // Team filter
    const date = new Date(dateParam);
    const dateEnd = new Date(date.getTime() + 24 * 60 * 60 * 1000);
    
    // Get current user with employee info
    const currentUser = await User.findById(currentUserId)
      .select('role employeeId isDepartmentHead headOfDepartments')
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
      
      if (departmentIds.length === 0 && teamMembers.length === 0) {
        return NextResponse.json({
          success: true,
          data: [],
          departments: [],
          message: 'You are not a department head or team leader'
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
    
    // === OPTIMIZED: Batch fetch all sessions in ONE query instead of N queries ===
    // Collect all userIds and employeeIds upfront
    const allUserIds = [];
    const allEmployeeIds = [];
    const memberMap = new Map(); // Map to quickly look up members by userId/employeeId
    
    teamMembers.forEach(member => {
      const userId = (member.user._id || member.user).toString();
      const employeeId = member._id.toString();
      
      allUserIds.push(userId);
      allEmployeeIds.push(employeeId);
      
      // Store member by both userId and employeeId for fast lookup
      memberMap.set(`user:${userId}`, member);
      memberMap.set(`emp:${employeeId}`, member);
    });
    
    // Single batched query for ALL sessions
    const allSessions = await ProductivitySession.find({
      $or: [
        { user: { $in: allUserIds } },
        { employee: { $in: allEmployeeIds } }
      ],
      date: { $gte: date, $lt: dateEnd }
    }).select('user employee sessionNumber screenshotCount screenshots analysis startTime endTime').lean();
    
    console.log(`[Team API] Fetched ${allSessions.length} sessions in single batched query`);

    // Fallback source: raw screenshots for users whose sessions are not yet synced
    const rawScreenshots = Screenshot
      ? await Screenshot.find({
          user: { $in: allUserIds },
          dateString: dateParam
        })
          .select('user path capturedAt gridfsFileId')
          .sort({ capturedAt: -1 })
          .lean()
      : [];

    const screenshotsByUser = new Map();
    rawScreenshots.forEach((shot) => {
      const userId = shot?.user?.toString();
      if (!userId) return;

      if (!screenshotsByUser.has(userId)) {
        screenshotsByUser.set(userId, {
          count: 0,
          latestPreview: null
        });
      }

      const bucket = screenshotsByUser.get(userId);
      bucket.count += 1;
      if (!bucket.latestPreview) {
        bucket.latestPreview = shot.path || (shot.gridfsFileId ? `/api/activity/screenshot?id=${shot._id}` : null);
      }
    });
    
    // Group sessions by member (using userId or employeeId)
    const sessionsByMember = new Map();
    
    // Initialize empty arrays for all members
    teamMembers.forEach(member => {
      const memberId = member._id.toString();
      sessionsByMember.set(memberId, []);
    });
    
    // Assign sessions to their respective members
    allSessions.forEach(session => {
      let memberId = null;
      
      // Try to match by user first
      if (session.user) {
        const userIdStr = session.user.toString();
        const member = memberMap.get(`user:${userIdStr}`);
        if (member) {
          memberId = member._id.toString();
        }
      }
      
      // If not matched by user, try by employee
      if (!memberId && session.employee) {
        const empIdStr = session.employee.toString();
        const member = memberMap.get(`emp:${empIdStr}`);
        if (member) {
          memberId = member._id.toString();
        }
      }
      
      // Add session to member's list
      if (memberId && sessionsByMember.has(memberId)) {
        sessionsByMember.get(memberId).push(session);
      }
    });
    
    // Process each member with their pre-fetched sessions (no more N queries!)
    const teamWithSessions = teamMembers.map(member => {
      const userId = member.user._id || member.user;
      const memberId = member._id.toString();
      
      // Get pre-fetched sessions for this member
      const sessions = sessionsByMember.get(memberId) || [];
      const fallbackShots = screenshotsByUser.get(userId.toString()) || { count: 0, latestPreview: null };
      
      // Calculate average score
      const analyzedSessions = sessions.filter(s => s.analysis?.isAnalyzed && s.analysis?.score != null);
      const avgScore = analyzedSessions.length > 0
        ? Math.round(analyzedSessions.reduce((sum, s) => sum + s.analysis.score, 0) / analyzedSessions.length)
        : null;
      
      // Get first screenshot URL from each session for preview
      const sessionsWithPreview = sessions.map(s => ({
        _id: s._id,
        sessionNumber: s.sessionNumber,
        screenshotCount: s.screenshotCount,
        isAnalyzed: s.analysis?.isAnalyzed || false,
        score: s.analysis?.score || null,
        startTime: s.startTime,
        endTime: s.endTime,
        // Include first screenshot for preview
        previewUrl: s.screenshots?.[0]?.url || s.screenshots?.[0]?.path || null,
        // Include all screenshots for modal view
        screenshots: s.screenshots || []
      }));

      const fallbackSessions = fallbackShots.count > 0 ? [{
        _id: `fallback-${memberId}`,
        sessionNumber: 1,
        screenshotCount: fallbackShots.count,
        isAnalyzed: false,
        score: null,
        startTime: null,
        endTime: null,
        previewUrl: fallbackShots.latestPreview,
        screenshots: fallbackShots.latestPreview ? [{ url: fallbackShots.latestPreview, path: fallbackShots.latestPreview }] : []
      }] : [];

      const totalSessions = sessions.length > 0
        ? sessions.length
        : Math.ceil(fallbackShots.count / SCREENSHOTS_PER_SESSION_ESTIMATE);

      const totalScreenshots = sessions.length > 0
        ? sessions.reduce((sum, s) => sum + (s.screenshotCount || 0), 0)
        : fallbackShots.count;
      
      return {
        _id: member._id,
        firstName: member.firstName,
        lastName: member.lastName,
        email: member.email,
        profilePicture: member.profilePicture,
        department: member.department?.name || 'N/A',
        designation: member.designation?.title || 'N/A',
        userId: userId.toString(),
        sessionsSummary: {
          totalSessions,
          totalScreenshots,
          analyzedSessions: analyzedSessions.length,
          averageScore: avgScore,
          sessions: sessionsWithPreview.length > 0 ? sessionsWithPreview : fallbackSessions
        }
      };
    });
    
    // Sort by average score (highest first), then by total sessions
    teamWithSessions.sort((a, b) => {
      if (a.sessionsSummary.averageScore !== null && b.sessionsSummary.averageScore !== null) {
        return b.sessionsSummary.averageScore - a.sessionsSummary.averageScore;
      }
      if (a.sessionsSummary.averageScore !== null) return -1;
      if (b.sessionsSummary.averageScore !== null) return 1;
      return b.sessionsSummary.totalSessions - a.sessionsSummary.totalSessions;
    });
    
    console.log(`[Team API] Returning ${teamWithSessions.length} team members for ${departmentName}`);
    
    // Build departments list for filter (only for multi-department heads)
    let availableDepartments = [];
    if (!isAdminOrHR && departments && departments.length > 1) {
      availableDepartments = departments.map(d => ({ _id: d._id, name: d.name, code: d.code }));
    }
    
    return NextResponse.json({
      success: true,
      data: teamWithSessions,
      date: dateParam,
      department: departmentName,
      departments: availableDepartments,
      totalMembers: teamWithSessions.length
    });
    
  } catch (error) {
    console.error('Get team sessions error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get team sessions', details: error.message },
      { status: 500 }
    );
  }
}
