import { NextResponse } from 'next/server';
import { verifyTokenFromRequest } from '@/lib/auth';
import { getProductivityViewStore, getProductivityVisibility, populateProductivityEmployees, queryProductivityByIds } from '@/lib/platform/firestoreProductivityView.server';

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
    const auth = await verifyTokenFromRequest(request);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }

    const { user, tenant } = auth;
    const store = await getProductivityViewStore(tenant.databaseName);
    const { searchParams } = new URL(request.url);

    // Parse date range (default to current year)
    const currentYear = new Date().getFullYear();
    const startDate = searchParams.get('startDate') || `${currentYear}-01-01`;
    const endDate = searchParams.get('endDate') || `${currentYear}-12-31`;
    const departmentFilter = searchParams.get('department');
    const departmentsFilter = searchParams.get('departments'); // Comma-separated list of department IDs
    const employeeIdFilter = searchParams.get('employeeId');

    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) return NextResponse.json({ message: 'Invalid date range' }, { status: 400 });
    const visible = await getProductivityVisibility(store, user, { includeSelf: Boolean(employeeIdFilter) });
    let employees = visible.employees;
    if (employeeIdFilter) {
      employees = employees.filter(value => String(value._id) === employeeIdFilter);
      if (!employees.length) return NextResponse.json({ message: 'Not authorized to view this employee productivity' }, { status: 403 });
    }
    const departmentIds = departmentsFilter ? departmentsFilter.split(',').map(value => value.trim()).filter(Boolean) : departmentFilter && departmentFilter !== 'all' ? [departmentFilter] : [];
    if (departmentIds.length) employees = employees.filter(value => [value.department, ...(value.departments || [])].some(id => departmentIds.includes(String(id))));
    const analyses = (await queryProductivityByIds(store, 'screenshotanalyses', 'employee', employees.map(value => value._id), [
      { field: 'date', operator: '>=', value: new Date(startDate) }, { field: 'date', operator: '<=', value: new Date(endDate + 'T23:59:59.999Z') },
    ])).sort((a, b) => new Date(a.date) - new Date(b.date));

    // Aggregate scores by employee — each ScreenshotAnalysis doc counts as 1 "session"
    const employeeScores = {};

    analyses.forEach((doc) => {
      const empId = doc.employee?.toString();
      if (!empId) return;
      const ai = doc.aiAnalysis || {};
      const score = Number.isFinite(Number(ai.score)) ? Number(ai.score) : null;
      const focusScore = Number.isFinite(Number(ai.focusScore)) ? Number(ai.focusScore) : null;

      if (!employeeScores[empId]) {
        employeeScores[empId] = {
          employeeId: empId,
          totalSessions: 0,
          analyzedSessions: 0,
          totalScore: 0,
          totalFocusScore: 0,
          scores: [],
          focusScores: [],
          timeDistribution: { deepWork: 0, collaboration: 0, administrative: 0, breaks: 0, unfocused: 0 },
          focusMetrics: { totalContextSwitches: 0, totalDistractions: 0 },
        };
      }

      const empScore = employeeScores[empId];
      empScore.totalSessions += 1;

      if (score != null) {
        empScore.analyzedSessions += 1;
        empScore.totalScore += score;
        empScore.scores.push(score);

        if (focusScore != null) {
          empScore.totalFocusScore += focusScore;
          empScore.focusScores.push(focusScore);
        }

        if (ai.timeDistribution) {
          empScore.timeDistribution.deepWork += Number(ai.timeDistribution.deepWork) || 0;
          empScore.timeDistribution.collaboration += Number(ai.timeDistribution.collaboration) || 0;
          empScore.timeDistribution.administrative += Number(ai.timeDistribution.administrative) || 0;
          empScore.timeDistribution.breaks += Number(ai.timeDistribution.breaks) || 0;
          empScore.timeDistribution.unfocused += Number(ai.timeDistribution.unfocused) || 0;
        }

        if (ai.focusMetrics) {
          empScore.focusMetrics.totalContextSwitches += Number(ai.focusMetrics.contextSwitches) || 0;
          empScore.focusMetrics.totalDistractions += Number(ai.focusMetrics.distractionCount) || 0;
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
