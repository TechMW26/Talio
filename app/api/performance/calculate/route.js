import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'
export const dynamic = 'force-dynamic'

// GET - Calculate performance metrics based on reviews, projects, tasks, attendance, and goals
export async function GET(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    const decoded = await verifyToken(token)
    
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Employee', 'ProjectMember', 'TaskAssignee', 'Attendance', 'PerformanceGoal', 'DailyGoal'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Employee, ProjectMember, TaskAssignee, Attendance, PerformanceGoal, DailyGoal } = models

    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get('employeeId')
    const startDateStr = searchParams.get('startDate')
    const endDateStr = searchParams.get('endDate')

    // Date range for filtering
    const startDate = startDateStr ? new Date(startDateStr) : new Date(new Date().setDate(new Date().getDate() - 30)) // Default last 30 days
    const endDate = endDateStr ? new Date(endDateStr) : new Date()

    // Calculate expected business days for attendance denominator
    function getBusinessDaysCount(startDate, endDate) {
      let count = 0;
      const curDate = new Date(startDate.getTime());
      while (curDate <= endDate) {
        const dayOfWeek = curDate.getDay();
        if(dayOfWeek !== 0 && dayOfWeek !== 6) count++;
        curDate.setDate(curDate.getDate() + 1);
      }
      return count;
    }
    const businessDays = getBusinessDaysCount(startDate, endDate) || 1;

    // Build query based on role
    let employeeQuery = { status: 'active' }
    
    if (decoded.role === 'employee') {
      employeeQuery._id = decoded.employeeId
    } else if (decoded.role === 'manager') {
      const teamMembers = await Employee.find({ 
        reportingManager: decoded.employeeId,
        status: 'active'
      }).select('_id')
      
      const teamMemberIds = teamMembers.map(member => member._id)
      employeeQuery._id = { $in: [...teamMemberIds, decoded.employeeId] }
    }
    // Admin and HR can see all employees

    if (employeeId) {
      employeeQuery._id = employeeId
    }

    // Fetch employees
    const employees = await Employee.find(employeeQuery)
      .populate('reviews.reviewedBy', 'firstName lastName')
      .populate('department', 'name')
      .select('firstName lastName employeeCode department reviews designation profilePicture')
      .lean()

    // Calculate performance metrics for each employee
    const performanceMetrics = await Promise.all(employees.map(async (employee) => {
      const empId = employee._id

      // 1. Reviews & Ratings
      let reviews = employee.reviews || []
      if (startDate || endDate) {
        reviews = reviews.filter(review => {
          const reviewDate = new Date(review.createdAt)
          return reviewDate >= startDate && reviewDate <= endDate
        })
      }
      
      const reviewsWithRating = reviews.filter(r => r.rating)
      const avgRating = reviewsWithRating.length > 0
        ? (reviewsWithRating.reduce((sum, r) => sum + r.rating, 0) / reviewsWithRating.length)
        : 0

      // 2. Projects
      const projectMemberships = await ProjectMember.find({ user: empId }).populate('project', 'status completionPercentage')
      const activeProjects = projectMemberships.filter(pm => ['ongoing', 'planned'].includes(pm.project?.status)).length
      const completedProjects = projectMemberships.filter(pm => pm.project?.status === 'completed').length
      const projectCompletionRate = projectMemberships.length > 0 
        ? (completedProjects / projectMemberships.length) * 100 
        : 0

      // 3. Tasks
      const taskAssignments = await TaskAssignee.find({ 
        user: empId,
        assignedAt: { $gte: startDate, $lte: endDate }
      }).populate('task', 'status dueDate')
      
      const totalTasks = taskAssignments.length
      const completedTasks = taskAssignments.filter(ta => ta.task?.status === 'completed').length
      const overdueTasks = taskAssignments.filter(ta => {
        return ta.task?.status !== 'completed' && ta.task?.dueDate && new Date(ta.task.dueDate) < new Date()
      }).length
      const taskCompletionRate = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0

      // 4. Attendance
      const attendanceRecords = await Attendance.find({
        employee: empId,
        date: { $gte: startDate, $lte: endDate }
      })
      
      const presentDays = attendanceRecords.filter(a => ['present', 'half-day', 'late'].includes(a.status)).length
      const lateDays = attendanceRecords.filter(a => a.checkInStatus === 'late').length
      
      // Attendance Score: (Present Days / Business Days) * 100
      // Penalize late days slightly (0.25 day penalty)
      const adjustedPresentDays = Math.max(0, presentDays - (lateDays * 0.25));
      const attendanceScore = Math.min(100, Math.round((adjustedPresentDays / businessDays) * 100));

      // 5. Goals (Performance Goals + Daily Goals)
      const perfGoals = await PerformanceGoal.find({
        employee: empId,
        createdAt: { $gte: startDate, $lte: endDate }
      })
      
      const dailyGoals = await DailyGoal.find({
        employee: empId,
        date: { $gte: startDate, $lte: endDate }
      })

      // Flatten daily goals (each DailyGoal doc has an array of goals)
      let totalDailyGoals = 0
      let completedDailyGoals = 0
      
      dailyGoals.forEach(dg => {
        if (dg.goals && dg.goals.length > 0) {
          totalDailyGoals += dg.goals.length
          completedDailyGoals += dg.goals.filter(g => g.status === 'completed').length
        }
      })

      const totalPerfGoals = perfGoals.length
      const completedPerfGoals = perfGoals.filter(g => g.status === 'completed' || g.progress === 100).length
      
      const totalGoals = totalPerfGoals + totalDailyGoals
      const completedGoals = completedPerfGoals + completedDailyGoals
      const goalCompletionRate = totalGoals > 0 ? (completedGoals / totalGoals) * 100 : 0

      // 6. Productivity Score - derived from task completion and attendance
      // Since desktop monitoring is removed, calculate productivity from other metrics
      let avgProductivityScore = 0
      if (totalTasks > 0 || presentDays > 0) {
        // Combine task completion rate (70%) and attendance (30%) for productivity
        avgProductivityScore = (taskCompletionRate * 0.7) + (attendanceScore * 0.3)
      }

      // --- CALCULATE SCORES ---

      // Quality Score (0-100)
      // Based on Reviews (primary) and Task Quality (secondary)
      let qualityScore = 0;
      if (reviewsWithRating.length > 0) {
        qualityScore = (avgRating / 5) * 100;
      } else if (totalTasks > 0) {
        // Fallback to task quality if no reviews
        const taskQuality = Math.max(0, taskCompletionRate - (overdueTasks * 10));
        qualityScore = taskQuality;
      } else {
        qualityScore = 0;
      }
      qualityScore = Math.round(qualityScore);

      // Innovation Score (0-100)
      // Derived from 'skills' or 'innovation' category reviews
      const innovationReviews = reviews.filter(r => ['skills', 'innovation'].includes(r.category))
      let innovationScore = 0;
      if (innovationReviews.length > 0) {
        const innovationRating = (innovationReviews.reduce((sum, r) => sum + (r.rating || 0), 0) / innovationReviews.length / 5) * 100;
        innovationScore = Math.round(innovationRating);
      } else {
        innovationScore = 0; // No innovation reviews = 0
      }

      // Engagement Score (0-100)
      // Combination of Attendance and Goal Completion
      const engagementScore = Math.round((attendanceScore * 0.6) + (goalCompletionRate * 0.4))

      // Productivity Score (0-100)
      const productivityScore = Math.round(avgProductivityScore)

      // Overall Performance Score (0-100)
      // Weighted Average:
      // - Productivity: 30% (Actual work output)
      // - Goals: 25% (Target achievement)
      // - Quality: 20% (Manager ratings)
      // - Engagement: 15% (Attendance & Participation)
      // - Innovation: 10% (Extra mile)
      let performanceScore = Math.round(
        (productivityScore * 0.30) +
        (goalCompletionRate * 0.25) +
        (qualityScore * 0.20) +
        (engagementScore * 0.15) +
        (innovationScore * 0.10)
      )

      // Determine performance level
      let performanceLevel = 'Not Rated'
      if (performanceScore >= 90) performanceLevel = 'Exceptional'
      else if (performanceScore >= 75) performanceLevel = 'Excellent'
      else if (performanceScore >= 60) performanceLevel = 'Good'
      else if (performanceScore >= 40) performanceLevel = 'Average'
      else if (performanceScore > 0) performanceLevel = 'Needs Improvement'
      else performanceLevel = 'Not Rated'

      return {
        employee: {
          _id: employee._id,
          firstName: employee.firstName,
          lastName: employee.lastName,
          employeeCode: employee.employeeCode,
          department: employee.department,
          designation: employee.designation,
          profilePicture: employee.profilePicture
        },
        metrics: {
          // Core Metrics
          performanceScore,
          performanceLevel,
          avgRating: parseFloat(avgRating.toFixed(1)),
          
          // Detailed Scores
          productivityScore,
          qualityScore,
          innovationScore,
          engagementScore,

          // Aliases for frontend compatibility
          productivity: productivityScore,
          quality: qualityScore,
          innovation: innovationScore,
          engagement: engagementScore,
          
          // Raw Data
          goals: {
            total: totalGoals,
            completed: completedGoals,
            completionRate: Math.round(goalCompletionRate)
          },
          projects: {
            active: activeProjects,
            completed: completedProjects,
            completionRate: Math.round(projectCompletionRate)
          },
          tasks: {
            total: totalTasks,
            completed: completedTasks,
            overdue: overdueTasks,
            completionRate: Math.round(taskCompletionRate)
          },
          attendance: {
            present: presentDays,
            late: lateDays,
            score: Math.round(attendanceScore)
          },
          reviews: {
            total: reviews.length,
            count: reviews.length
          }
        }
      }
    }))

    // Sort by performance score
    performanceMetrics.sort((a, b) => b.metrics.performanceScore - a.metrics.performanceScore)

    // Calculate Department Performance
    const departmentPerformance = {}
    performanceMetrics.forEach(p => {
      const deptName = p.employee.department?.name || 'Unknown'
      if (!departmentPerformance[deptName]) {
        departmentPerformance[deptName] = {
          department: deptName,
          totalScore: 0,
          totalRating: 0,
          totalGoalCompletion: 0,
          totalProductivity: 0,
          count: 0
        }
      }
      departmentPerformance[deptName].totalScore += p.metrics.performanceScore
      departmentPerformance[deptName].totalRating += parseFloat(p.metrics.avgRating)
      departmentPerformance[deptName].totalGoalCompletion += p.metrics.goalCompletion
      departmentPerformance[deptName].totalProductivity += p.metrics.productivity
      departmentPerformance[deptName].count += 1
    })

    const departmentStats = Object.values(departmentPerformance).map(d => ({
      department: d.department,
      avgScore: Math.round(d.totalScore / d.count),
      avgRating: parseFloat((d.totalRating / d.count).toFixed(1)),
      goalCompletion: Math.round(d.totalGoalCompletion / d.count),
      productivity: Math.round(d.totalProductivity / d.count)
    }))

    return NextResponse.json({
      success: true,
      data: performanceMetrics,
      summary: {
        totalEmployees: performanceMetrics.length,
        avgPerformanceScore: performanceMetrics.length > 0
          ? Math.round(performanceMetrics.reduce((sum, p) => sum + p.metrics.performanceScore, 0) / performanceMetrics.length)
          : 0,
        avgRating: performanceMetrics.length > 0
          ? parseFloat((performanceMetrics.reduce((sum, p) => sum + parseFloat(p.metrics.avgRating), 0) / performanceMetrics.length).toFixed(1))
          : 0,
        goalCompletionRate: performanceMetrics.length > 0
          ? Math.round(performanceMetrics.reduce((sum, p) => sum + p.metrics.goalCompletion, 0) / performanceMetrics.length)
          : 0,
        projectCompletionRate: performanceMetrics.length > 0
          ? Math.round(performanceMetrics.reduce((sum, p) => sum + p.metrics.projectCompletion, 0) / performanceMetrics.length)
          : 0,
        productivityIndex: performanceMetrics.length > 0
          ? Math.round(performanceMetrics.reduce((sum, p) => sum + p.metrics.productivity, 0) / performanceMetrics.length)
          : 0,
        qualityScore: performanceMetrics.length > 0
          ? Math.round(performanceMetrics.reduce((sum, p) => sum + p.metrics.quality, 0) / performanceMetrics.length)
          : 0,
        innovationScore: performanceMetrics.length > 0
          ? Math.round(performanceMetrics.reduce((sum, p) => sum + p.metrics.innovation, 0) / performanceMetrics.length)
          : 0,
        engagementScore: performanceMetrics.length > 0
          ? Math.round(performanceMetrics.reduce((sum, p) => sum + p.metrics.engagement, 0) / performanceMetrics.length)
          : 0,
        topPerformers: performanceMetrics.filter(p => p.metrics.performanceScore >= 85).length,
        departmentPerformance: departmentStats
      }
    })

  } catch (error) {

    console.error('Calculate performance error:', error)
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    )
  }
}

