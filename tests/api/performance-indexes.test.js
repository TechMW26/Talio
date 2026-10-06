const manifest = require('../../firestore.indexes.json')
const contains = fields => manifest.indexes.some(index => JSON.stringify(index.fields) === JSON.stringify([...fields.map(([name, mode = 'ASCENDING']) => ({ fieldPath: 'data.' + name, ...(mode === 'CONTAINS' ? { arrayConfig: 'CONTAINS' } : { order: mode }) })), { fieldPath: '__name__', order: 'ASCENDING' }]))
test.each([
  [['status'], ['createdAt', 'DESCENDING']],
  [['employee'], ['createdAt', 'DESCENDING']],
  [['employee'], ['status'], ['createdAt', 'DESCENDING']],
  [['employee'], ['reviewPeriod'], ['status']],
  [['approverUserIds', 'CONTAINS'], ['updatedAt', 'DESCENDING']],
])('native query indexes cover performance scope and ordering %j', (...fields) => {
  expect(contains(fields)).toBe(true)
})
test('index declarations are unique and retain explicit document cursor ordering', () => {
  expect(new Set(manifest.indexes.map(index => JSON.stringify(index))).size).toBe(manifest.indexes.length)
  for (const index of manifest.indexes) {
    expect(index.collectionGroup).toBe('records')
    expect(index.queryScope).toBe('COLLECTION')
    expect(index.fields.at(-1)).toEqual({ fieldPath: '__name__', order: 'ASCENDING' })
  }
})
