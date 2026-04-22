import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import { generateContent } from '@/lib/gemini';
import { parseAIJsonResponse } from '@/lib/aiJsonResponse';

/**
 * GET /api/dashboard/ai-insights
 * Generates personalized AI-powered actionable insights for the employee dashboard.
 * Uses attendance trends, leave balance, tasks, and work patterns to produce
 * short, actionable guidance.
 */
export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, ['Attendance', 'Leave', 'LeaveBalance', 'LeaveType', 'Task', 'DailyGoal']);
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 });
    }

    const { user, models } = auth;
    const { Attendance, Leave, LeaveBalance, LeaveType, Task, DailyGoal } = models;

    const employeeId = user.employeeId?._id || user.employeeId;
    const userId = user._id || user.userId;
    const now = new Date();

    // --- Gather data in parallel ---
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [attendanceRecords, leaveBalances, recentLeaves, pendingTasks, dailyGoals] = await Promise.all([
      // Last 30 days attendance
      Attendance.find({
        employee: employeeId,
        date: { $gte: thirtyDaysAgo },
      }).select('date checkIn checkOut status totalHours lateMinutes').sort({ date: -1 }).lean(),

      // Leave balances
      LeaveBalance.find({ employee: employeeId })
        .populate('leaveType', 'name')
        .lean(),

      // Recent leave applications (last 30 days)
      Leave.find({
        employee: employeeId,
        createdAt: { $gte: thirtyDaysAgo },
      }).select('startDate endDate status leaveType reason').lean(),

      // Pending tasks
      Task.find({
        $or: [
          { assignedTo: employeeId },
          { assignees: employeeId },
        ],
        status: { $in: ['pending', 'in-progress', 'todo'] },
      }).select('title dueDate priority status').sort({ dueDate: 1 }).limit(10).lean(),

      // Today's daily goals
      DailyGoal.find({
        employee: employeeId,
        date: { $gte: todayStart },
      }).select('title completed').lean(),
    ]);

    // --- Compute metrics ---

    // Attendance metrics
    const totalDays = attendanceRecords.length;
    const presentDays = attendanceRecords.filter(a => a.status === 'present' || a.checkIn).length;
    const lateDays = attendanceRecords.filter(a => a.lateMinutes > 0 || a.status === 'late').length;
    const avgHours = totalDays > 0
      ? (attendanceRecords.reduce((sum, a) => sum + (a.totalHours || 0), 0) / totalDays).toFixed(1)
      : '0';

    // Work hours trend (last 7 days)
    const last7Days = attendanceRecords.filter(a => new Date(a.date) >= sevenDaysAgo);
    const weeklyHoursData = last7Days.map(a => ({
      date: new Date(a.date).toLocaleDateString('en-US', { weekday: 'short' }),
      hours: parseFloat((a.totalHours || 0).toFixed(1)),
      late: a.lateMinutes || 0,
    })).reverse();

    // Leave balance summary
    const leavesSummary = leaveBalances.map(lb => ({
      type: lb.leaveType?.name || 'Unknown',
      used: lb.used || 0,
      total: lb.total || 0,
      remaining: (lb.total || 0) - (lb.used || 0),
    }));

    // Tasks summary
    const overdueTasks = pendingTasks.filter(t => t.dueDate && new Date(t.dueDate) < now);
    const highPriorityTasks = pendingTasks.filter(t => t.priority === 'high' || t.priority === 'urgent');

    // Daily goals
    const totalGoals = dailyGoals.length;
    const completedGoals = dailyGoals.filter(g => g.completed).length;

    // --- Build AI prompt ---
    const dataContext = `
Employee Data Summary:
- Attendance (last 30 days): ${presentDays}/${totalDays} days present, ${lateDays} days late, avg ${avgHours} hrs/day
- Weekly hours: ${weeklyHoursData.map(d => `${d.date}: ${d.hours}h`).join(', ')}
- Leave balance: ${leavesSummary.map(l => `${l.type}: ${l.remaining}/${l.total} remaining`).join(', ')}
- Pending tasks: ${pendingTasks.length} (${overdueTasks.length} overdue, ${highPriorityTasks.length} high priority)
- Today's goals: ${completedGoals}/${totalGoals} completed
- Current time: ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
`;

    const systemPrompt = `You are MIRA, the AI assistant for Talio HR platform. Generate exactly 3 short, actionable insights for this employee based on their data. Each insight must be practical and motivating.

Rules:
- Each insight must be 1-2 sentences max
- Be specific with numbers from the data
- Focus on actionable advice, not just observations
- Use a warm, professional tone
- Return ONLY a valid JSON array of objects with fields: "title" (3-5 words), "insight" (the advice), "type" (one of: attendance, productivity, wellness, tasks, leave), "priority" (high/medium/low)
- No markdown, no code fences, just the JSON array`;

    let aiInsights = [];
    try {
      const aiResponse = await generateContent(dataContext, systemPrompt);
      aiInsights = parseAIJsonResponse(aiResponse, { expectedRoot: 'array' });
    } catch {
      // Fallback insights if AI fails
      aiInsights = [
        {
          title: 'Keep Up the Pace',
          insight: `You've been present ${presentDays} out of ${totalDays} workdays this month. ${lateDays > 3 ? 'Try to reduce late arrivals for a stronger record.' : 'Great consistency!'}`,
          type: 'attendance',
          priority: lateDays > 3 ? 'high' : 'low',
        },
        {
          title: 'Task Status Check',
          insight: overdueTasks.length > 0
            ? `You have ${overdueTasks.length} overdue task${overdueTasks.length > 1 ? 's' : ''}. Prioritize these to stay on track.`
            : `${pendingTasks.length} tasks in your queue. You're on top of things!`,
          type: 'tasks',
          priority: overdueTasks.length > 0 ? 'high' : 'low',
        },
        {
          title: 'Leave Balance Update',
          insight: leavesSummary.length > 0
            ? `You have ${leavesSummary.reduce((s, l) => s + l.remaining, 0)} total leave days remaining. Plan ahead!`
            : 'Check your leave balance in the Leave section.',
          type: 'leave',
          priority: 'low',
        },
      ];
    }

    return NextResponse.json({
      success: true,
      data: {
        insights: aiInsights,
        metrics: {
          attendance: {
            presentDays,
            totalDays,
            lateDays,
            avgHours: parseFloat(avgHours),
            attendanceRate: totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0,
          },
          weeklyHours: weeklyHoursData,
          leaveBalance: leavesSummary,
          tasks: {
            pending: pendingTasks.length,
            overdue: overdueTasks.length,
            highPriority: highPriorityTasks.length,
          },
          goals: {
            total: totalGoals,
            completed: completedGoals,
          },
        },
        pendingTasks: pendingTasks.slice(0, 5).map(t => ({
          title: t.title,
          dueDate: t.dueDate,
          priority: t.priority,
          status: t.status,
        })),
      },
    });
  } catch (error) {
    console.error('[AI Insights] Error:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to generate insights' },
      { status: 500 }
    );
  }
}
