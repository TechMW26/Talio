import getTenantCompanyModel from '@/models/TenantCompany'
import {
  buildCacheKey,
  buildCachePattern,
  clearCachePattern,
  getCache,
  setCache,
} from '@/lib/cache'
import { mergeCompanyFeatures } from '@/lib/planFeatures'

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
  }

  await setCache(cacheKey, response, 300)
  return response
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