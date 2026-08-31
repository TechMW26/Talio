function parseInteger(value, fallback, { minimum = 0 } = {}) {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : fallback
}

const SCOPE_DEFAULTS = {
  primary: { development: 20, production: 50, vercel: 5 },
  superadmin: { development: 5, production: 20, vercel: 3 },
  tenant: { development: 10, production: 20, vercel: 3 },
}

export function getMongoPoolConfig(scope, env = process.env) {
  const defaults = SCOPE_DEFAULTS[scope]
  if (!defaults) throw new TypeError(`Unknown MongoDB pool scope: ${scope}`)

  const isProduction = env.NODE_ENV === 'production'
  const isVercel = env.VERCEL === '1'
  const environmentDefault = isVercel
    ? defaults.vercel
    : isProduction
      ? defaults.production
      : defaults.development

  const prefix = scope === 'tenant'
    ? 'TENANT_DB'
    : scope === 'superadmin'
      ? 'SUPERADMIN_DB'
      : 'MONGODB'

  const maxPoolSize = parseInteger(env[`${prefix}_MAX_POOL_SIZE`], environmentDefault, { minimum: 1 })
  const defaultMinPoolSize = isVercel ? 0 : scope === 'primary' && isProduction ? 10 : scope === 'superadmin' && isProduction ? 5 : 1
  const requestedMinPoolSize = parseInteger(env[`${prefix}_MIN_POOL_SIZE`], defaultMinPoolSize)

  return {
    maxPoolSize,
    minPoolSize: Math.min(requestedMinPoolSize, maxPoolSize),
    // Keep self-hosted connections open (no idle timeout). A short idle timeout
    // was closing every connection after 60s of inactivity, forcing a full
    // reconnect each minute — which churned connections and leaked memory.
    maxIdleTimeMS: isVercel ? 60_000 : 0,
  }
}

