import { apiSuccess, withTenantApi } from '@/lib/api/route'
import { listDirectory, directoryInternals } from '@/lib/services/directoryService.server'

export const dynamic = 'force-dynamic'

export const GET = withTenantApi({
  models: ['Employee', 'User', 'Designation', 'Department'],
  features: { allOf: ['employees'] },
  errorMessage: 'Failed to load employee directory',
}, async ({ request, auth, models }) => {
  const { searchParams } = new URL(request.url)
  const items = await listDirectory({
    Employee: models.Employee,
    User: models.User,
    Department: models.Department,
    Designation: models.Designation,
    tenantId: auth.tenant.databaseName,
    currentUserId: auth.user.id || auth.user._id,
    query: searchParams.get('q') || '',
    limit: searchParams.get('limit'),
    page: searchParams.get('page'),
    includeAdmins: searchParams.get('includeAdmins') !== 'false',
    includeSelf: searchParams.get('includeSelf') === 'true',
  })

  return apiSuccess(items, { meta: { count: items.length, hasMore: items.length === directoryInternals.clampLimit(searchParams.get('limit')) } })
})
