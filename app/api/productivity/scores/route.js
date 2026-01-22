import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';

/**
 * GET /api/productivity/scores
 * Get productivity scores aggregated by employee for performance reports
 * 
 * Query params:
 * - startDate: Start of date range (YYYY-MM-DD)
 * - endDate: End of date range (YYYY-MM-DD)
 * - department: Filter by department ID (optional)
 * - employeeId: Get scores for specific employee (optional)
 */
export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, ['ProductivitySession', 'Employee', 'User', 'Department']);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }

    const { user, models } = auth;
    const { ProductivitySession, Employee, Department, User } = models;
    const { searchParams } = new URL(request.url);

    // Parse date range (default to current year)
    const currentYear = new Date().getFullYear();
    const startDate = searchParams.get('startDate') || `${currentYear}-01-01`;
    const endDate = searchParams.get('endDate') || `${currentYear}-12-31`;
    const departmentFilter = searchParams.get('department');
    const departmentsFilter = searchParams.get('departments'); // Comma-separated list of department IDs
    const employeeIdFilter = searchParams.get('employeeId');

    // Permission check
    const isAdminOrHR = ['admin', 'hr'].includes(user.role);
    const currentUser = await User.findById(user._id).populate('employeeId');

    // Check if user is department head
    let isDeptHead = false;
    let userDepartmentIds = [];

    if (!isAdminOrHR) {
      // Check if current user is a department head
      if (currentUser?.isDepartmentHead && currentUser?.headOfDepartments?.length > 0) {
        isDeptHead = true;
        userDepartmentIds = currentUser.headOfDepartments.map(d => d.toString());
      } else if (currentUser?.employeeId?.department) {
        // Check department's head/heads field
        const userDept = await Department.findById(currentUser.employeeId.department);
        const currentEmployeeId = currentUser?.employeeId?._id?.toString();
        if (userDept) {
          const isLegacyHead = userDept.head?.toString() === currentEmployeeId;
          const isInHeadsArray = userDept.heads?.some(h => h?.toString() === currentEmployeeId);
          if (isLegacyHead || isInHeadsArray) {
            isDeptHead = true;
            userDepartmentIds = [userDept._id.toString()];
          }
        }
      }

      // If not admin/HR and not dept head, can only see own data
      if (!isDeptHead && !employeeIdFilter) {
        return NextResponse.json({
          success: true,
          data: [],
          message: 'No permission to view team productivity scores'
        });
      }
    }

    // Build employee filter
    let employeeQuery = {};
    
    if (employeeIdFilter) {
      // Specific employee requested
      employeeQuery._id = employeeIdFilter;
      
      // Non-admin/HR must verify they can view this employee
      if (!isAdminOrHR && isDeptHead) {
        const targetEmployee = await Employee.findById(employeeIdFilter);
        if (!targetEmployee || !userDepartmentIds.includes(targetEmployee.department?.toString())) {
          return NextResponse.json({
            success: false,
            message: 'Not authorized to view this employee\'s productivity'
          }, { status: 403 });
        }
      }
    } else if (departmentsFilter) {
      // Handle multiple departments filter (comma-separated)
      const deptIds = departmentsFilter.split(',').filter(id => id.trim());
      if (!isAdminOrHR && isDeptHead) {
        // Validate department head can only see their departments
        const validDeptIds = deptIds.filter(id => userDepartmentIds.includes(id));
        if (validDeptIds.length === 0) {
          return NextResponse.json({
            success: false,
            message: 'Not authorized to view these departments'
          }, { status: 403 });
        }
        employeeQuery.department = { $in: validDeptIds };
      } else if (isAdminOrHR) {
        employeeQuery.department = { $in: deptIds };
      }
    } else if (departmentFilter && departmentFilter !== 'all') {
      // Department filter
      if (!isAdminOrHR && isDeptHead && !userDepartmentIds.includes(departmentFilter)) {
        return NextResponse.json({
          success: false,
          message: 'Not authorized to view this department\'s productivity'
        }, { status: 403 });
      }
      employeeQuery.department = departmentFilter;
    } else if (isDeptHead && !isAdminOrHR) {
      // Department head can only see their departments
      employeeQuery.department = { $in: userDepartmentIds };
    }
    // For admin/HR with no filter, show all employees (no department filter added)

    // Get employees matching the filter
    const employees = await Employee.find(employeeQuery).select('_id firstName lastName department').lean();
    const employeeIds = employees.map(e => e._id);

    console.log('[Productivity Scores] Query params:', { startDate, endDate, departmentFilter, employeeIdFilter });
    console.log('[Productivity Scores] Found employees:', employeeIds.length, employeeIds.slice(0, 3).map(id => id.toString()));

    // Get all analyzed sessions in the date range for these employees
    const sessions = await ProductivitySession.find({
      employee: { $in: employeeIds },
      date: {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      },
      'analysis.isAnalyzed': true,
      'analysis.score': { $exists: true, $ne: null }
    }).select('employee date analysis.score analysis.focusScore analysis.timeDistribution analysis.focusMetrics').lean();

    console.log('[Productivity Scores] Found sessions:', sessions.length, sessions.slice(0, 3).map(s => ({ emp: s.employee?.toString(), score: s.analysis?.score, date: s.date })));

    // Aggregate scores by employee
    const employeeScores = {};
    
    sessions.forEach(session => {
      const empId = session.employee.toString();
      
      if (!employeeScores[empId]) {
        employeeScores[empId] = {
          employeeId: empId,
          totalSessions: 0,
          analyzedSessions: 0,
          totalScore: 0,
          totalFocusScore: 0,
          scores: [],
          focusScores: [],
          timeDistribution: {
            deepWork: 0,
            collaboration: 0,
            administrative: 0,
            breaks: 0,
            unfocused: 0
          },
          focusMetrics: {
            totalContextSwitches: 0,
            totalDistractions: 0
          }
        };
      }
      
      const empScore = employeeScores[empId];
      empScore.totalSessions++;
      
      if (session.analysis?.score != null) {
        empScore.analyzedSessions++;
        empScore.totalScore += session.analysis.score;
        empScore.scores.push(session.analysis.score);
        
        if (session.analysis.focusScore != null) {
          empScore.totalFocusScore += session.analysis.focusScore;
          empScore.focusScores.push(session.analysis.focusScore);
        }
        
        // Aggregate time distribution
        if (session.analysis.timeDistribution) {
          empScore.timeDistribution.deepWork += session.analysis.timeDistribution.deepWork || 0;
          empScore.timeDistribution.collaboration += session.analysis.timeDistribution.collaboration || 0;
          empScore.timeDistribution.administrative += session.analysis.timeDistribution.administrative || 0;
          empScore.timeDistribution.breaks += session.analysis.timeDistribution.breaks || 0;
          empScore.timeDistribution.unfocused += session.analysis.timeDistribution.unfocused || 0;
        }
        
        // Aggregate focus metrics
        if (session.analysis.focusMetrics) {
          empScore.focusMetrics.totalContextSwitches += session.analysis.focusMetrics.contextSwitches || 0;
          empScore.focusMetrics.totalDistractions += session.analysis.focusMetrics.distractionCount || 0;
        }
      }
    });

    // Calculate averages and format response
    const productivityData = employees.map(emp => {
      const empId = emp._id.toString();
      const scores = employeeScores[empId];
      
      if (!scores || scores.analyzedSessions === 0) {
        return {
          employeeId: empId,
          employeeName: `${emp.firstName} ${emp.lastName}`,
          department: emp.department,
          totalSessions: scores?.totalSessions || 0,
          analyzedSessions: 0,
          averageProductivityScore: null,
          averageFocusScore: null,
          productivityTrend: null,
          timeDistribution: null,
          focusMetrics: null
        };
      }
      
      const avgScore = Math.round(scores.totalScore / scores.analyzedSessions);
      const avgFocusScore = scores.focusScores.length > 0 
        ? Math.round(scores.totalFocusScore / scores.focusScores.length) 
        : null;
      
      // Calculate trend (compare recent half vs older half)
      let trend = null;
      if (scores.scores.length >= 4) {
        const midpoint = Math.floor(scores.scores.length / 2);
        const olderAvg = scores.scores.slice(0, midpoint).reduce((a, b) => a + b, 0) / midpoint;
        const recentAvg = scores.scores.slice(midpoint).reduce((a, b) => a + b, 0) / (scores.scores.length - midpoint);
        trend = Math.round(recentAvg - olderAvg);
      }
      
      // Calculate average time distribution
      const sessionCount = scores.analyzedSessions;
      const avgTimeDistribution = {
        deepWork: Math.round(scores.timeDistribution.deepWork / sessionCount),
        collaboration: Math.round(scores.timeDistribution.collaboration / sessionCount),
        administrative: Math.round(scores.timeDistribution.administrative / sessionCount),
        breaks: Math.round(scores.timeDistribution.breaks / sessionCount),
        unfocused: Math.round(scores.timeDistribution.unfocused / sessionCount)
      };
      
      return {
        employeeId: empId,
        employeeName: `${emp.firstName} ${emp.lastName}`,
        department: emp.department,
        totalSessions: scores.totalSessions,
        analyzedSessions: scores.analyzedSessions,
        averageProductivityScore: avgScore,
        averageFocusScore: avgFocusScore,
        productivityTrend: trend,
        timeDistribution: avgTimeDistribution,
        focusMetrics: {
          avgContextSwitches: Math.round(scores.focusMetrics.totalContextSwitches / sessionCount),
          avgDistractions: Math.round(scores.focusMetrics.totalDistractions / sessionCount)
        }
      };
    });

    // Calculate overall averages
    const employeesWithScores = productivityData.filter(e => e.averageProductivityScore != null);
    const overallAvg = employeesWithScores.length > 0
      ? Math.round(employeesWithScores.reduce((sum, e) => sum + e.averageProductivityScore, 0) / employeesWithScores.length)
      : null;

    return NextResponse.json({
      success: true,
      data: productivityData,
      summary: {
        totalEmployees: employees.length,
        employeesWithData: employeesWithScores.length,
        overallAverageScore: overallAvg,
        dateRange: { startDate, endDate }
      }
    });

  } catch (error) {
    console.error('[Productivity Scores API] Error:', error);
    return NextResponse.json({
      success: false,
      message: 'Failed to fetch productivity scores',
      error: error.message
    }, { status: 500 });
  }
}
