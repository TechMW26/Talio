export function getRuntimeEnvironment(env = process.env) {
  if (env.VERCEL === '1') return 'vercel'
  if (env.KUBERNETES_SERVICE_HOST) return 'kubernetes'
  return env.NODE_ENV === 'development' ? 'development' : 'node'
}

export function getRuntimeCapabilities(env = process.env) {
  const runtime = getRuntimeEnvironment(env)
  const isVercel = runtime === 'vercel'
  const localAcceptance = env.TALIO_LOCAL_ACCEPTANCE === '1'

  return {
    runtime,
    isVercel,
    localAcceptance,
    persistentFilesystem: !isVercel,
    persistentProcess: !isVercel,
    blobStorage: Boolean(env.BLOB_READ_WRITE_TOKEN),
    distributedCache: !localAcceptance && Boolean(env.REDIS_URL || env.REDIS_HOST),
    managedRealtime: !localAcceptance && Boolean(
      env.PUSHER_APP_ID
      && env.PUSHER_KEY
      && env.PUSHER_SECRET
      && env.PUSHER_CLUSTER,
    ),
    managedMeetings: Boolean(
      env.LIVEKIT_URL
      && env.LIVEKIT_API_KEY
      && env.LIVEKIT_API_SECRET,
    ),
    durableQueue: isVercel,
  }
}

const VERCEL_REQUIREMENTS = [
  ['authentication', ['JWT_SECRET']],
  ['application URL', ['NEXT_PUBLIC_APP_URL']],
  ['scheduled jobs', ['CRON_SECRET']],
  ['managed realtime', ['PUSHER_APP_ID', 'PUSHER_KEY', 'PUSHER_SECRET', 'PUSHER_CLUSTER', 'NEXT_PUBLIC_PUSHER_KEY', 'NEXT_PUBLIC_PUSHER_CLUSTER']],
  ['managed meetings', ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET']],
]

// Structural validation only, without loading the database driver into this
// shared capability module, opening a pool, resolving DNS, or exposing values.
// Mongo's connection layer remains authoritative for driver-specific options.
function validMongoUri(value) {
  if (typeof value !== 'string' || /\s|#/.test(value)) return false
  const match = value.match(/^(mongodb(?:\+srv)?):\/\/([^/?]+)(?:\/[^?]*)?(?:\?.*)?$/)
  if (!match) return false
  const authority = match[2], at = authority.lastIndexOf('@')
  if (at >= 0) {
    const credentials = authority.slice(0, at)
    if (!credentials || credentials.includes('@')) return false
    try { decodeURIComponent(credentials) } catch { return false }
  }
  const hosts = authority.slice(at + 1).split(',')
  if (match[1] === 'mongodb+srv' && (hosts.length !== 1 || !/^[a-z\d-]+(?:\.[a-z\d-]+)+$/i.test(hosts[0]))) return false
  return hosts.every(host => {
    if (!/^(?:\[[a-f\d:.]+\]|[a-z\d_.-]+)(?::\d+)?$/i.test(host)) return false
    try {
      const parsed = new URL(`http://${host}`)
      return Boolean(parsed.hostname) && (!parsed.port || Number(parsed.port) > 0)
    } catch { return false }
  })
}

export function getVercelReadiness(env = process.env) {
  const provider = env.TALIO_DATABASE_PROVIDER || 'mongodb'
  const databaseKeys = ['MONGODB_URI', 'MONGODB_DATABASE', 'MONGODB_DATASET']
  const missing = [['database', databaseKeys], ...VERCEL_REQUIREMENTS].flatMap(([capability, keys]) => {
    const missingKeys = keys.filter((key) => !env[key])
    return missingKeys.length ? [{ capability, missingKeys }] : []
  })
  if (!env.BLOB_READ_WRITE_TOKEN) {
    missing.push({ capability: 'private object storage', missingKeys: ['BLOB_READ_WRITE_TOKEN'] })
  }
  const invalid = []
  if (env.MONGODB_URI && !validMongoUri(env.MONGODB_URI)) {
    invalid.push({ capability: 'database', message: 'MONGODB_URI must be a structurally valid MongoDB connection URI' })
  }
  if (env.MONGODB_DATABASE && (typeof env.MONGODB_DATABASE !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,62}$/.test(env.MONGODB_DATABASE))) {
    invalid.push({ capability: 'database', message: 'MONGODB_DATABASE has an invalid format' })
  }
  if (env.MONGODB_DATASET && (typeof env.MONGODB_DATASET !== 'string' || !/^[a-z][a-z0-9-]{7,79}$/.test(env.MONGODB_DATASET))) {
    invalid.push({ capability: 'database', message: 'MONGODB_DATASET has an invalid format' })
  }
  const vercelProduction = env.VERCEL === '1' && (env.VERCEL_ENV === 'production' || (!env.VERCEL_ENV && env.NODE_ENV === 'production'))
  if (vercelProduction && env.TALIO_LOCAL_ACCEPTANCE === '1') {
    invalid.push({ capability: 'production isolation', message: 'Local acceptance mode must not be enabled in production' })
  }
  if (provider !== 'mongodb') {
    invalid.push({ capability: 'database', message: 'MongoDB is the only application database provider' })
  }
  if (env.BLOB_ACCESS && env.BLOB_ACCESS !== 'private') {
    invalid.push({ capability: 'private object storage', message: 'BLOB_ACCESS must be private' })
  }
  if (env.NEXT_PUBLIC_REALTIME_PROVIDER && env.NEXT_PUBLIC_REALTIME_PROVIDER !== 'pusher') {
    invalid.push({ capability: 'managed realtime', message: 'NEXT_PUBLIC_REALTIME_PROVIDER must be pusher' })
  }
  if (env.NEXT_PUBLIC_MEETING_TRANSPORT && env.NEXT_PUBLIC_MEETING_TRANSPORT !== 'livekit') {
    invalid.push({ capability: 'managed meetings', message: 'Legacy meeting transports are not supported on Vercel' })
  }
  return { ready: missing.length === 0 && invalid.length === 0, missing, invalid }
}
