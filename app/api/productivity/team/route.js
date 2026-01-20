import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';

/**
 * GET /api/productivity/team
 * Get team members with their session summaries for department heads and admins
 */
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['ProductivitySession', 'User', 'Employee', 'Department']);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }
    const { user, models } = auth;
    const { ProductivitySession, User, Employee, Department } = models;

    const currentUserId = (user._id || user.userId).toString();
    const currentUserRole = user.role;
    
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date') || new Date().toISOString().split('T')[0];
    const departmentFilter = searchParams.get('department'); // Department filter for admin/HR
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
      
      if (departmentIds.length === 0) {
        return NextResponse.json({
          success: true,
          data: [],
          departments: [],
          message: 'You are not a department head'
        });
      }
      
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
    
    // Get session summaries for each team member
    const teamWithSessions = await Promise.all(
      teamMembers.map(async (member) => {
        const userId = member.user._id || member.user;
        const employeeId = member._id; // The Employee document ID
        
        // Get sessions for this date - query by user OR employee
        const sessions = await ProductivitySession.find({
          $or: [
            { user: userId },
            { employee: employeeId }
          ],
          date: { $gte: date, $lt: dateEnd }
        }).select('sessionNumber screenshotCount screenshots analysis startTime endTime').lean();
        
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
            totalSessions: sessions.length,
            totalScreenshots: sessions.reduce((sum, s) => sum + s.screenshotCount, 0),
            analyzedSessions: analyzedSessions.length,
            averageScore: avgScore,
            sessions: sessionsWithPreview
          }
        };
      })
    );
    
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
