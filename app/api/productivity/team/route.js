import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import connectDB from '@/lib/mongodb';
import ProductivitySession from '@/models/ProductivitySession';
import User from '@/models/User';
import Employee from '@/models/Employee';
import Department from '@/models/Department';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

/**
 * GET /api/productivity/team
 * Get team members with their session summaries for department heads and admins
 */
export async function GET(request) {
  try {
    // Verify JWT token
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    let decoded;
    try {
      decoded = await jwtVerify(token, JWT_SECRET);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid token' },
        { status: 401 }
      );
    }

    const currentUserId = decoded.payload.userId;
    const currentUserRole = decoded.payload.role;
    
    await connectDB();
    
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date') || new Date().toISOString().split('T')[0];
    const date = new Date(dateParam);
    const dateEnd = new Date(date.getTime() + 24 * 60 * 60 * 1000);
    
    // Get current user
    const currentUser = await User.findById(currentUserId).populate('employeeId');
    
    const isAdminOrHR = ['admin', 'hr'].includes(currentUserRole);
    
    let teamMembers = [];
    let departmentName = null;
    
    if (isAdminOrHR) {
      // Admin/HR can see all employees
      const employees = await Employee.find({ status: 'active' })
        .select('firstName lastName email profilePicture department designation user')
        .populate('department', 'name')
        .populate('designation', 'title')
        .populate('user', '_id')
        .lean();
      
      teamMembers = employees.filter(e => e.user);
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
        .select('firstName lastName email profilePicture department designation user')
        .populate('department', 'name')
        .populate('designation', 'title')
        .populate('user', '_id')
        .lean();
      
      teamMembers = employees.filter(e => e.user);
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
