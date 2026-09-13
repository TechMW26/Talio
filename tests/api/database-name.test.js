import { assertDatabaseName } from '@/lib/platform/databaseName'

test.each(['talio_company_one', 'talio_company_123', 'legacy-db'])('accepts existing database %s', name => {
  expect(assertDatabaseName(name, { tenant: true })).toBe(name)
})
test.each(['', null, {}, 'a/b', 'a?authSource=admin', 'a b', 'a.b', 'a'.repeat(64), 'a\u0000b'])('rejects invalid database %p', name => {
  expect(() => assertDatabaseName(name)).toThrow('Invalid database name')
})
test.each(['admin', 'local', 'config', 'talio_superadmin', 'ADMIN'])('rejects system database %s for tenant access', name => {
  expect(() => assertDatabaseName(name, { tenant: true })).toThrow('System databases')
})
test('control-plane URI construction can still use the superadmin database', () => {
  expect(assertDatabaseName('talio_superadmin')).toBe('talio_superadmin')
})
