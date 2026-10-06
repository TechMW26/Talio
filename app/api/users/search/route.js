import { NextResponse } from 'next/server'
import { withTenantApi } from '@/lib/api/route'
import { listDirectory, DIRECTORY_STORE_OPTIONS } from '@/lib/services/directoryService.server'

// Compatibility endpoint. New consumers should use GET /api/directory.
export const GET = withTenantApi({
  firestore: DIRECTORY_STORE_OPTIONS,
  features: { allOf: ['employees'] },
  errorMessage: 'Failed to search users',
}, async ({ request, auth, database }) => {
  const { searchParams } = new URL(request.url)
  const items = await listDirectory({
    database,
    tenantId: auth.tenant.databaseName,
    currentUserId: auth.user.id || auth.user._id,
    query: searchParams.get('q') || '',
    limit: searchParams.get('limit') || 10,
    includeAdmins: true,
    includeSelf: false,
  })

  const users = items
    .filter((item) => item.userId)
    .map((item) => ({
      _id: item.userId,
      name: item.name,
      email: item.email,
      avatar: item.avatar,
      role: item.role,
    }))

  return NextResponse.json({ users, count: users.length })
})
