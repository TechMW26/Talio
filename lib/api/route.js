import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { checkTenantFeatureAccess } from '@/lib/companyFeatures.server'
export { getPagination } from '@/lib/api/query'

export function apiSuccess(data = null, options = {}) {
  const { status = 200, message, meta } = options
  return NextResponse.json({
    success: true,
    ...(message ? { message } : {}),
    ...(data !== null ? { data } : {}),
    ...(meta ? { meta } : {}),
  }, { status })
}

export function apiError(message, options = {}) {
  const { status = 500, code, details } = options
  return NextResponse.json({
    success: false,
    message,
    ...(code ? { code } : {}),
    ...(details ? { details } : {}),
  }, { status })
}

/**
 * Tenant-aware route composition. It centralizes authentication, model loading,
 * role checks, feature enforcement and safe error formatting while allowing
 * legacy response shapes to be preserved by the handler.
 */
export function withTenantApi(config, handler) {
  const {
    models = [],
    roles = [],
    features = null,
    errorMessage = 'Request failed',
  } = config || {}

  return async function tenantRoute(request, context = {}) {
    try {
      const auth = await getAuthAndModels(request, models)
      if (!auth.success) return apiError(auth.message || 'Unauthorized', {
        status: auth.status || 401,
        code: auth.code || 'UNAUTHORIZED',
        details: auth.missingFeatures?.length ? { missingFeatures: auth.missingFeatures } : undefined,
      })

      if (roles.length && !roles.includes(auth.user?.role)) {
        return apiError('You do not have permission to perform this action', { status: 403, code: 'FORBIDDEN' })
      }

      if (features) {
        const access = await checkTenantFeatureAccess(auth, features)
        if (!access.success) {
          return apiError(access.message, {
            status: access.status,
            code: access.code,
            details: access.missing ? { missingFeatures: access.missing } : undefined,
          })
        }
        auth.companyFeatures = access.features
      }

      return await handler({ request, context, auth, models: auth.models || {} })
    } catch (error) {
      console.error(`[Tenant API] ${errorMessage}:`, error)
      return apiError(errorMessage, { status: 500, code: 'INTERNAL_ERROR' })
    }
  }
}
