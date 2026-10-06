import { NextResponse } from 'next/server';
import { dashboardAuth, dashboardEmployee } from '@/lib/dashboardData.server';
import { projectRows, projectRecords, projectFilter as f, projectId as id } from '@/lib/projects.server';
import { generateContent } from '@/lib/gemini';
import { parseAIJsonResponse } from '@/lib/aiJsonResponse';
import { formatDesignation, formatDepartments } from '@/lib/formatters';
import { normalizeLeaveBalance } from '@/lib/leaveData';

/**
 * GET /api/dashboard/ai-insights
 * Generates personalized AI-powered actionable insights for the employee dashboard.
 * Uses attendance trends, leave balance, tasks, and work patterns to produce
 * short, actionable guidance.
 */
export async function GET(request) {
  try {
    const auth = await dashboardAuth(request);
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 });
    }

    const { user, database } = auth;

    const employeeId = user.employeeId?._id || user.employeeId;
    const userId = user._id || user.userId;
    const now = new Date();

    const employeeProfile = employeeId
      ? await dashboardEmployee(database, employeeId)
      : null;

    const roleDesignation = employeeProfile ? formatDesignation(employeeProfile.designation, employeeProfile) : 'Not available';
    const roleDepartment = employeeProfile ? formatDepartments(employeeProfile) : 'Not available';
    const roleKri = employeeProfile
      ? [
        ...(employeeProfile.manualKRIs || []),
        ...((employeeProfile.aiGeneratedKRIs || []).map((item) => item?.title).filter(Boolean))
      ].slice(0, 8)
      : [];

    // --- Gather data in parallel ---
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [attendanceRecords, leaveBalances, recentLeaves, pendingTasks, dailyGoals] = await Promise.all([
      // Last 30 days attendance
      projectRows(database, 'attendances', [f('employee', id(employeeId)), f('date', thirtyDaysAgo, '>=')], { orderBy: [{ field: 'date', direction: 'desc' }] }),

      // Leave balances
      projectRows(database, 'leavebalances', [f('employee', id(employeeId))]).then(rows => Promise.all(rows.map(async row => ({ ...row, leaveType: row.leaveType ? await database.get('leavetypes', id(row.leaveType)) : null })))),

      // Recent leave applications (last 30 days)
      projectRows(database, 'leaves', [f('employee', id(employeeId)), f('createdAt', thirtyDaysAgo, '>=')]),

      // Pending tasks
      projectRows(database, 'taskassignees', [f('user', id(employeeId)), f('assignmentStatus', ['pending', 'accepted'], 'in')]).then(rows => projectRecords(database, 'tasks', rows.map(row => row.task))).then(rows => rows.filter(row => !row.deletedAt && ['pending', 'in-progress', 'todo'].includes(row.status)).sort((a, b) => +new Date(a.dueDate) - +new Date(b.dueDate)).slice(0, 10)),

      // Today's daily goals
      projectRows(database, 'dailygoals', [f('employee', id(employeeId)), f('date', todayStart, '>=')]),
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
    const leavesSummary = leaveBalances.map(rawBalance => {
      const balance = normalizeLeaveBalance(rawBalance);
      return {
        type: balance.leaveType?.name || 'Unknown',
        used: balance.usedDays,
        total: balance.totalDays,
        remaining: balance.remainingDays,
      };
    });

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
- Designation: ${roleDesignation}
- Department(s): ${roleDepartment}
- KRIs: ${roleKri.length > 0 ? roleKri.join('; ') : 'Not configured'}
`;

    const systemPrompt = `You are MIRA, the AI assistant for Talio HR platform. Generate exactly 3 short, actionable insights for this employee based on their data. Each insight must be practical and motivating.

Rules:
- Each insight must be 1-2 sentences max
- Be specific with numbers from the data
- Focus on actionable advice, not just observations
- Use a warm, professional tone
- Evaluate advice in context of designation/KRIs. Do not penalize role-appropriate research/exploration work.
- Return ONLY a valid JSON array of objects with fields: "title" (3-5 words), "insight" (the advice), "type" (one of: attendance, productivity, wellness, tasks, leave), "priority" (high/medium/low)
- No markdown, no code fences, just the JSON array`;

    let aiInsights = [];
    try {
      const aiResponse = await generateContent(dataContext, systemPrompt, { useCase: 'analysis' });
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
