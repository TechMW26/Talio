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
    const date = new Date(dateParam);
    const dateEnd = new Date(date.getTime() + 24 * 60 * 60 * 1000);
    
    // Get current user with employee info
    const currentUser = await User.findById(currentUserId).populate('employeeId');
    
    const isAdminOrHR = ['admin', 'hr'].includes(currentUserRole);
    
    let teamMembers = [];
    let departmentName = null;
    
    if (isAdminOrHR) {
      // Admin/HR can see all employees
      const employees = await Employee.find({ status: 'active' })
        .select('firstName lastName email profilePicture department designation userId')
        .populate('department', 'name')
        .populate('designation', 'title')
        .lean();
      
      // Filter only employees with userId
      teamMembers = employees.filter(e => e.userId).map(e => ({
        ...e,
        user: e.userId // Map userId to user for consistency
      }));
      departmentName = 'All Departments';
    } else {
      // Check if user is department head
      const currentEmployeeId = currentUser?.employeeId?._id;
      
      if (!currentEmployeeId) {
        return NextResponse.json({
          success: true,
          data: [],
          message: 'No employee profile linked'
        });
      }
      
      // Find department where user is head
      const department = await Department.findOne({
        $or: [
          { head: currentEmployeeId },
          { heads: currentEmployeeId }
        ],
        isActive: true
      });
      
      if (!department) {
        return NextResponse.json({
          success: true,
          data: [],
          message: 'You are not a department head'
        });
      }
      
      departmentName = department.name;
      
      // Get all employees in this department
      const employees = await Employee.find({ 
        department: department._id,
        status: 'active'
      })
        .select('firstName lastName email profilePicture department designation userId')
        .populate('department', 'name')
        .populate('designation', 'title')
        .lean();
      
      // Filter only employees with userId and map for consistency
      teamMembers = employees.filter(e => e.userId).map(e => ({
        ...e,
        user: e.userId // Map userId to user for consistency
      }));
    }
    
    // Get session summaries for each team member
    const teamWithSessions = await Promise.all(
      teamMembers.map(async (member) => {
        const userId = member.user._id || member.user;
        
        // Get sessions for this date
        const sessions = await ProductivitySession.find({
          user: userId,
          date: { $gte: date, $lt: dateEnd }
        }).select('sessionNumber screenshotCount analysis.score analysis.isAnalyzed startTime endTime');
        
        // Calculate average score
        const analyzedSessions = sessions.filter(s => s.analysis?.isAnalyzed && s.analysis?.score != null);
        const avgScore = analyzedSessions.length > 0
          ? Math.round(analyzedSessions.reduce((sum, s) => sum + s.analysis.score, 0) / analyzedSessions.length)
          : null;
        
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
            sessions: sessions.map(s => ({
              sessionNumber: s.sessionNumber,
              screenshotCount: s.screenshotCount,
              isAnalyzed: s.analysis?.isAnalyzed || false,
              score: s.analysis?.score || null,
              startTime: s.startTime,
              endTime: s.endTime
            }))
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
    
    return NextResponse.json({
      success: true,
      data: teamWithSessions,
      date: dateParam,
      department: departmentName,
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
