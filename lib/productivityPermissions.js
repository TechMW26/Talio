import { isDirectReport } from '@/lib/teamScope';
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server';

export async function canViewTenantScreenshots(viewerId, targetUserId, viewerRole, databaseName) {
  if (['admin', 'hr'].includes(viewerRole) || String(viewerId) === String(targetUserId)) return true;
  const store = await getFirestoreTenantDatabase(databaseName);
  const [viewer, target] = await store.getMany('users', [String(viewerId), String(targetUserId)]);
  if (!viewer?.employeeId || !target?.employeeId) return false;
  const [viewerEmployee, targetEmployee] = await store.getMany('employees', [String(viewer.employeeId), String(target.employeeId)]);
  if (!viewerEmployee || !targetEmployee) return false;
  if (isDirectReport(targetEmployee, viewerEmployee._id)) return true;
  if (viewer.teamLeaderOf?.length) {
    for (let offset = 0; offset < viewer.teamLeaderOf.length; offset += 100) {
      const teams = await store.getMany('teams', viewer.teamLeaderOf.slice(offset, offset + 100).map(String));
      if (teams.some(team => team?.isActive !== false && [...(team?.members || []), ...(team?.teamLeaders || [])].some(id => String(id) === String(targetEmployee._id)))) return true;
    }
  }
  const ids = [...new Set([targetEmployee.department, ...(targetEmployee.departments || [])].filter(Boolean).map(String))];
  if (!ids.length) return false;
  if (viewer.isDepartmentHead && viewer.headOfDepartments?.some(id => ids.includes(String(id)))) return true;
  for (let offset = 0; offset < ids.length; offset += 100) {
    const departments = await store.getMany('departments', ids.slice(offset, offset + 100));
    if (departments.some(value => value && [value.head, ...(value.heads || [])].some(id => String(id) === String(viewerEmployee._id)))) return true;
  }
  return false;
}
