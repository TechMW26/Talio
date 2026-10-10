'use strict'

function isMigrationFrozen(env = process.env) {
  return env.TALIO_MIGRATION_FREEZE === '1'
}

// Producer maintenance is deliberately separate from the full write fence.
// Queue consumers must retain writes (and internal follow-up work) while draining.
function isMigrationProducerPaused(env = process.env) {
  return env.TALIO_MIGRATION_PRODUCER_PAUSE === '1'
}

function isMigrationDrainCallback(pathname, method) {
  return method === 'POST' && (
    pathname === '/api/queues/background' || pathname === '/api/queues/webhooks'
  )
}

function assertMigrationWritesAllowed(env = process.env) {
  if (isMigrationFrozen(env)) {
    throw Object.assign(new Error('Talio database migration is in progress; retry shortly'), {
      code: 'MIGRATION_WRITE_FENCE', status: 503, retryAfter: 60,
    })
  }
}

module.exports = {
  isMigrationFrozen, isMigrationProducerPaused, isMigrationDrainCallback,
  assertMigrationWritesAllowed,
}
