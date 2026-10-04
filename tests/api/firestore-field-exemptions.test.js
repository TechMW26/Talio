const { validate, run } = require('../../scripts/firestore-migration/deploy-field-exemptions.cjs')
const manifest = require('../../firestore.indexes.json')
test('exemptions never remove business query indexes', () => {
  expect(validate(manifest)).toHaveLength(3)
  expect(() => validate({ fieldOverrides: [{ collectionGroup: 'records', fieldPath: 'data', indexes: [] }] })).toThrow()
  for (const index of manifest.indexes) for (const field of index.fields) expect(field.fieldPath).toMatch(/^(data\.|__name__$)/)
})
test('missing admin permission causes no index mutation', async () => {
  const client = { request: jest.fn(async () => ({ data: { permissions: [] } })) }
  await expect(run(client, manifest, true)).rejects.toThrow('no fields changed')
  expect(client.request).toHaveBeenCalledTimes(1)
})
