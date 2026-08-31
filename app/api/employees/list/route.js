import { NextResponse } from 'next/server'
import { withTenantApi } from '@/lib/api/route'
import { listDirectory } from '@/lib/services/directoryService.server'

export const dynamic = 'force-dynamic'

// Compatibility endpoint. New consumers should use GET /api/directory.
export const GET = withTenantApi({
  models: ['Employee', 'User', 'Designation', 'Department'],
  features: { allOf: ['employees'] },
  errorMessage: 'Failed to fetch employees',
}, async ({ request, auth, models }) => {
  const { searchParams } = new URL(request.url)
  const data = await listDirectory({
    Employee: models.Employee,
    User: models.User,
    tenantId: auth.tenant.databaseName,
    currentUserId: auth.user.id || auth.user._id,
    query: searchParams.get('q') || searchParams.get('search') || '',
    limit: searchParams.get('limit') || 100,
    includeAdmins: searchParams.get('includeAdmins') === 'true',
    includeSelf: searchParams.get('includeSelf') === 'true',
  })

  return NextResponse.json({ success: true, data })
})
