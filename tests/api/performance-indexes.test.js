const { INDEXES, sameIndex } = require('../../scripts/migrate-performance-indexes')

test('index audit compares ordered key definitions, not names', () => {
  const definition = INDEXES.employees[0]
  expect(sameIndex({ key: definition.key, name: 'legacy-name' }, definition)).toBe(true)
  expect(sameIndex({ key: { _id: -1, createdAt: -1 } }, definition)).toBe(false)
  expect(sameIndex({ key: { createdAt: -1 } }, definition)).toBe(false)
})
test.each([{ sparse: true }, { partialFilterExpression: { status: 'active' } }, { collation: { locale: 'en' } }])('does not confuse restricted index %p with full index', options => {
  expect(sameIndex({ key: INDEXES.employees[0].key, ...options }, INDEXES.employees[0])).toBe(false)
})
