export function getRuntimeEnvironment(env = process.env) {
  if (env.VERCEL === '1') return 'vercel'
  if (env.KUBERNETES_SERVICE_HOST) return 'kubernetes'
  if (env.DOCKER_CONTAINER === 'true') return 'docker'
  return env.NODE_ENV === 'development' ? 'development' : 'node'
}

export function getRuntimeCapabilities(env = process.env) {
  const runtime = getRuntimeEnvironment(env)
  const isVercel = runtime === 'vercel'

  return {
    runtime,
    isVercel,
    persistentFilesystem: !isVercel,
    persistentProcess: !isVercel,
    blobStorage: Boolean(env.BLOB_READ_WRITE_TOKEN),
    distributedCache: Boolean(env.REDIS_URL || env.REDIS_HOST),
    managedRealtime: Boolean(
      env.PUSHER_APP_ID
      && env.PUSHER_KEY
      && env.PUSHER_SECRET
      && env.PUSHER_CLUSTER,
    ),
    managedMeetings: Boolean(
      env.LIVEKIT_URL
      && env.LIVEKIT_API_KEY
      && env.LIVEKIT_API_SECRET
      && env.NEXT_PUBLIC_LIVEKIT_URL,
    ),
    durableQueue: isVercel,
  }
}

const VERCEL_REQUIREMENTS = [
  ['database', ['MONGODB_URI']],
  ['authentication', ['JWT_SECRET']],
  ['application URL', ['NEXT_PUBLIC_APP_URL']],
  ['private object storage', ['BLOB_READ_WRITE_TOKEN']],
  ['scheduled jobs', ['CRON_SECRET']],
  ['managed realtime', ['PUSHER_APP_ID', 'PUSHER_KEY', 'PUSHER_SECRET', 'PUSHER_CLUSTER', 'NEXT_PUBLIC_PUSHER_KEY', 'NEXT_PUBLIC_PUSHER_CLUSTER']],
  ['managed meetings', ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'NEXT_PUBLIC_LIVEKIT_URL']],
]

export function getVercelReadiness(env = process.env) {
  const missing = VERCEL_REQUIREMENTS.flatMap(([capability, keys]) => {
    const missingKeys = keys.filter((key) => !env[key])
    return missingKeys.length ? [{ capability, missingKeys }] : []
  })
  const invalid = []
  if (env.NEXT_PUBLIC_REALTIME_PROVIDER && env.NEXT_PUBLIC_REALTIME_PROVIDER !== 'pusher') {
    invalid.push({ capability: 'managed realtime', message: 'NEXT_PUBLIC_REALTIME_PROVIDER must be pusher' })
  }
  if (env.NEXT_PUBLIC_MEETING_TRANSPORT && env.NEXT_PUBLIC_MEETING_TRANSPORT !== 'livekit') {
    invalid.push({ capability: 'managed meetings', message: 'NEXT_PUBLIC_MEETING_TRANSPORT must be livekit' })
  }
  return { ready: missing.length === 0 && invalid.length === 0, missing, invalid }
}
