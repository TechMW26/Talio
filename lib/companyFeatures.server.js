import getTenantCompanyModel from '@/models/TenantCompany'
import {
  buildCacheKey,
  buildCachePattern,
  clearCachePattern,
  getCache,
  setCache,
} from '@/lib/cache'
import { mergeCompanyFeatures } from '@/lib/planFeatures'
import { HRMS_MODULES, HRMS_PHASES } from '@/lib/hrms/moduleRegistry'

function buildSharedFeatureCacheKey({ companySlug, databaseName }) {
  return buildCacheKey({
    tenantId: databaseName,
    role: 'any',
    userId: 'shared',
    namespace: 'company-features',
    params: { slug: companySlug },
  })
}

export async function getTenantCompanyFeaturePayload({ companySlug, databaseName }) {
  if (!companySlug || !databaseName) {
    return null
  }

  const cacheKey = buildSharedFeatureCacheKey({ companySlug, databaseName })
  const cached = await getCache(cacheKey)
  if (cached) {
    return cached
  }

  const TenantCompany = await getTenantCompanyModel()
  const company = await TenantCompany.findOne(
    { slug: companySlug, isActive: true },
    'features miraTokens subscription.plan subscription.status updatedAt slug databaseName'
  ).lean()

  if (!company) {
    return null
  }

  const plan = company.subscription?.plan || 'custom'
  const response = {
    success: true,
    features: mergeCompanyFeatures(company.features, plan),
    plan,
    miraTokens: company.miraTokens || { perUserAllocation: 0 },
    updatedAt: company.updatedAt,
    companySlug: company.slug,
    databaseName: company.databaseName,
    modules: HRMS_MODULES,
    modulePhases: HRMS_PHASES,
  }

  await setCache(cacheKey, response, 300)
  return response
}

/**
 * Server-side feature gate. Routes must use this in addition to UI hiding.
 */
export async function checkTenantFeatureAccess(auth, { allOf = [], anyOf = [] } = {}) {
  if (!auth?.success || !auth?.tenant?.companySlug || !auth?.tenant?.databaseName) {
    return { success: false, status: 401, message: 'Tenant authentication is required' }
  }

  const payload = await getTenantCompanyFeaturePayload({
    companySlug: auth.tenant.companySlug,
    databaseName: auth.tenant.databaseName,
  })

  if (!payload) {
    return { success: false, status: 403, message: 'Tenant feature configuration was not found' }
  }

  const missing = allOf.filter((featureKey) => payload.features[featureKey] !== true)
  const anyAllowed = anyOf.length === 0 || anyOf.some((featureKey) => payload.features[featureKey] === true)
  if (missing.length || !anyAllowed) {
    return {
      success: false,
      status: 403,
      code: 'FEATURE_DISABLED',
      message: 'This module is disabled for your company',
      missing: missing.length ? missing : anyOf,
    }
  }

  return { success: true, features: payload.features, plan: payload.plan }
}

export async function clearTenantCompanyFeaturesCache({ companySlug, databaseName }) {
  if (!databaseName) {
    return
  }

  const pattern = buildCachePattern({
    tenantId: databaseName,
    role: '*',
    userId: '*',
    namespace: 'company-features',
  })

  await clearCachePattern(pattern)
}
