const fs = require('node:fs')
const { changedFieldNames, recordDifference, recordComparison, writeReport } = require('../../scripts/firestore-migration/verify-native.cjs')

const original = { _id: 'private-user-identifier', email: 'private@example.test', lastLogin: new Date('2026-10-01T00:00:00Z'), settings: { theme: 'dark' }, bytes: Buffer.from([1, 2]) }
const createReport = () => ({ complete: false, recordsCompared: 0, recordsVerified: 0, routedHistoriesCompared: 0, routedHistories: 0, differences: [], countDifferences: [] })
const difference = actual => recordDifference({ database: 'test-tenant', collection: 'users', recordId: original._id, expected: original, actual, expectedSourceHash: 'expected', actualSourceHash: null })

test('compares every field without serializing source or target values and hashes record identity', () => {
  const actual = { ...original, lastLogin: new Date('2026-10-03T00:00:00Z'), cacheUpdatedAt: new Date(), settings: { theme: 'light' } }
  expect(changedFieldNames(original, actual)).toEqual(['cacheUpdatedAt', 'lastLogin', 'settings'])
  const result = difference(actual)
  expect(result).toMatchObject({ fields: ['cacheUpdatedAt', 'lastLogin', 'settings'], sourceProvenanceChanged: true, sourceProvenanceMissing: true })
  expect(result.recordIdentifierHash).toMatch(/^[a-f0-9]{64}$/)
  const serialized = JSON.stringify(result)
  for (const value of [original._id, original.email, 'dark', 'light', '2026-10-03']) expect(serialized).not.toContain(value)
})

test('reports unusual user-entered map keys as hashed field names', () => {
  expect(changedFieldNames({}, { 'private@example.test': 'secret-value' })[0]).toMatch(/^field-sha256-[a-f0-9]{64}$/)
})

test('strict default rejects provenance changes even when all business fields match', () => {
  const result = difference(original)
  expect(result.fields).toEqual([])
  expect(() => recordComparison(createReport(), result, false)).toThrow('source_provenance_changed')
})

test('report mode continues after missing and changed records and tracks compared versus exact counts', () => {
  const report = createReport()
  recordComparison(report, difference({ ...original, email: 'changed@example.test' }), true)
  recordComparison(report, recordDifference({ database: 'test-tenant', collection: 'users', recordId: 'missing', expected: original, actual: null, expectedSourceHash: 'expected', actualSourceHash: null, issues: ['record_missing'] }), true)
  recordComparison(report, null, true)
  recordComparison(report, null, true, true)
  expect(report).toMatchObject({ recordsCompared: 3, recordsVerified: 1, routedHistoriesCompared: 1, routedHistories: 1 })
  expect(report.differences).toHaveLength(2)
})

test('difference reports are separate exclusive files and never replace passing acceptance evidence', () => {
  const write = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
  try {
    const report = createReport()
    report.countDifferences.push({ database: 'test-tenant', collection: 'usersessions', expectedCount: 1, actualCount: 2, delta: 1 })
    const filename = writeReport('/local-report-fixture', 'local-fixture-dataset', report, true)
    expect(filename).toMatch(/^local-fixture-dataset-native-differences-\d+\.json$/)
    expect(filename).not.toContain('native-acceptance.json')
    expect(report).toMatchObject({ complete: true, passed: false })
    expect(write).toHaveBeenCalledWith(`/local-report-fixture/${filename}`, expect.any(String), { mode: 0o600, flag: 'wx' })
    expect(JSON.parse(write.mock.calls[0][1]).countDifferences[0].delta).toBe(1)
  } finally { write.mockRestore() }
})
