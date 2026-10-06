import { NextResponse } from 'next/server';
import { verifyTokenFromRequest } from '@/lib/auth';
import { getProductivityViewStore, getProductivityVisibility, populateProductivityEmployees, queryProductivityByIds } from '@/lib/platform/firestoreProductivityView.server';
import { getTodayDateString } from '@/lib/timezone';

/**
 * GET /api/productivity/team
 * Returns team members with their per-day screenshot/analysis summary.
 * Pure raw-screenshot model — no ProductivitySession dependency.
 */
export async function GET(request) {
  try {
    const auth = await verifyTokenFromRequest(request);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }
    const { user, tenant } = auth;
    const store = await getProductivityViewStore(tenant.databaseName);

    const currentUserId = (user._id || user.userId).toString();
    const currentUserRole = user.role;

    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date') || getTodayDateString();
    const departmentFilter = searchParams.get('department');
    const teamFilter = searchParams.get('team');

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) return NextResponse.json({ message: 'Invalid date' }, { status: 400 });
    const visible = await getProductivityVisibility(store, user, { activeOnly: true });
    const isAdminOrHR = visible.admin, departments = visible.departments;
    let employees = visible.employees;
    let departmentName = isAdminOrHR ? 'All Departments' : departments.map(value => value.name).join(', ') || visible.teams.map(value => value.teamName).join(', ') || 'Direct reports';
    if (departmentFilter && departmentFilter !== 'all') {
      employees = employees.filter(value => [value.department, ...(value.departments || [])].map(String).includes(departmentFilter));
      const department = await store.get('departments', departmentFilter);
      departmentName = department?.name || 'Filtered Department';
    }
    if (teamFilter && teamFilter !== 'all') {
      const team = await store.get('teams', teamFilter);
      const members = new Set([...(team?.members || []), ...(team?.teamLeaders || [])].map(String));
      employees = employees.filter(value => members.has(String(value._id)));
    }
    const teamMembers = (await populateProductivityEmployees(store, employees.filter(value => value.userId))).map(value => ({ ...value, user: value.userId }));
    const allUserIds = teamMembers.map(value => String(value.user));
    const dateScope = [{ field: 'dateString', operator: '==', value: dateParam }];
    const captures = await queryProductivityByIds(store, 'screenshots', 'user', allUserIds, dateScope);
    const countMap = new Map();
    for (const capture of captures) {
      const key = String(capture.user), row = countMap.get(key) || { _id: key, total: 0, analyzed: 0, latestAt: null };
      row.total++; if (capture.analyzed === true) row.analyzed++;
      if (!row.latestAt || new Date(capture.capturedAt) > new Date(row.latestAt)) row.latestAt = capture.capturedAt;
      countMap.set(key, row);
    }
    const screenshotCounts = [...countMap.values()];

    const countsByUser = new Map();
    for (const row of screenshotCounts) {
      countsByUser.set(row._id.toString(), {
        total: row.total || 0,
        analyzed: row.analyzed || 0,
        pending: Math.max(0, (row.total || 0) - (row.analyzed || 0)),
        latestAt: row.latestAt || null,
      });
    }

    const composites = await queryProductivityByIds(store, 'screenshotcomposites', 'user', allUserIds, dateScope);
    for (const composite of composites) {
      const compositeUserId = composite.user?.toString();
      if (!compositeUserId) continue;
      const existing = countsByUser.get(compositeUserId) || {
        total: 0,
        analyzed: 0,
        pending: 0,
        latestAt: null,
      };
      const tileCount = composite.tileCount || 0;
      countsByUser.set(compositeUserId, {
        total: existing.total + tileCount,
        analyzed: existing.analyzed + tileCount,
        pending: existing.pending,
        latestAt: existing.latestAt || composite.updatedAt || composite.createdAt || null,
      });
    }

    // Per-user analysis (one doc per user/day)
    const analyses = await queryProductivityByIds(store, 'screenshotanalyses', 'user', allUserIds, dateScope);
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
