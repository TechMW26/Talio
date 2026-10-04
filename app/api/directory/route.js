import { apiSuccess, withTenantApi } from '@/lib/api/route'
import { listDirectory, directoryInternals, DIRECTORY_STORE_OPTIONS } from '@/lib/services/directoryService.server'

export const dynamic = 'force-dynamic'

export const GET = withTenantApi({
  firestore: DIRECTORY_STORE_OPTIONS,
  features: { allOf: ['employees'] },
  errorMessage: 'Failed to load employee directory',
}, async ({ request, auth, database }) => {
  const { searchParams } = new URL(request.url)
  const items = await listDirectory({
    database,
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
