const { childEnvironment } = require('../../scripts/mongodb-migration/http-acceptance.cjs')
const dataset = 'http-acceptance-123456789012345678901234'
test('HTTP acceptance child is namespace-isolated, loopback-bound and disables external credentials', () => {
  const env = childEnvironment({ MONGODB_URI: 'private-test-uri', MONGODB_DATABASE: 'talio_test', MONGODB_DATASET: 'production-source', JWT_SECRET: 'production-key', BLOB_READ_WRITE_TOKEN: 'private-blob-key', REDIS_URL: 'private-cache', FIREBASE_SERVICE_ACCOUNT_KEY: 'private-fcm-key', PUSHER_SECRET: 'private-pusher-key' }, dataset, 3999)
  expect(env).toMatchObject({ MONGODB_URI: 'private-test-uri', MONGODB_DATABASE: 'talio_test', MONGODB_DATASET: dataset, TALIO_LOCAL_ACCEPTANCE: '1', TALIO_DATABASE_PROVIDER: 'mongodb', TALIO_MIGRATION_FREEZE: '0', VERCEL: '0', NODE_ENV: 'development', NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3999', NEXT_DIST_DIR: '.next-dev-3999', BLOB_READ_WRITE_TOKEN: '', REDIS_URL: '', FIREBASE_SERVICE_ACCOUNT_KEY: '', PUSHER_SECRET: '' })
  expect(env.JWT_SECRET).not.toBe('production-key')
  expect(env.JWT_SECRET).toMatch(/^[a-f0-9]{96}$/)
})
test('HTTP acceptance cannot reuse a production dataset or low privileged port', () => {
  expect(() => childEnvironment({}, 'production-source', 3999)).toThrow('ISOLATED')
  expect(() => childEnvironment({}, dataset, 80)).toThrow('ISOLATED')
})
