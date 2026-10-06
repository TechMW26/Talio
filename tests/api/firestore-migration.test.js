const { BSON, ObjectId, Long, Decimal128, Binary, Timestamp } = require('bson')
const { Readable } = require('node:stream')
const { encodeRecord, decodeRecord, readBson, segment, assertRunId, selectDatabases, mapLimit, gridfsDigests, sha256, canonicalProjection } = require('../../scripts/firestore-migration/core.cjs')

describe('lossless Firestore migration staging', () => {
  const raw = BSON.serialize({
    _id: new ObjectId('6957a99685e0572e1762c1b5'),
    ref: new ObjectId('69ce3faad0b5e8aec0b2ff11'),
    password: 'existing-hash-must-not-be-rehashed',
    date: new Date('2025-01-01T01:02:03.123Z'),
    long: Long.fromString('9223372036854775807'),
    money: Decimal128.fromString('1234.567890123456789'),
    binary: new Binary(Buffer.from([0, 1, 255])),
    ts: Timestamp.fromNumber(123),
    nested: [[1, 2], [3, null]],
    regex: /abc/i,
    unicode: 'हिन्दी',
  })

  test('preserves exact BSON bytes and sensitive fields without lossy conversion', () => {
    expect(decodeRecord(encodeRecord(raw).value).equals(raw)).toBe(true)
  })
  test('rejects corruption', () => {
    const value = encodeRecord(raw).value
    value.sha256 = 'incorrect'
    expect(() => decodeRecord(value)).toThrow('CHECKSUM_MISMATCH')
  })
  test('projects ordinary fields for native Firestore queries', () => {
    const id = new ObjectId()
    const date = new Date('2026-10-01T00:00:00Z')
    const record = encodeRecord(BSON.serialize({ _id: id, tenant: id, email: 'test@example.invalid', createdAt: date })).value
    expect(record.data._id).toBe(id.toHexString())
    expect(record.data.tenant).toBe(id.toHexString())
    expect(record.data.createdAt).toEqual(date)
    expect(record.projection).toBe('native-v1-objectids-as-strings')
  })
  test('does not truncate unsupported nested arrays or large documents', () => {
    expect(encodeRecord(raw).value.projection).toContain('archive-only')
    const large = BSON.serialize({ _id: 'large', content: 'a'.repeat(1100000) })
    const value = encodeRecord(large).value
    expect(value.data).toBeUndefined()
    expect(decodeRecord(value)).toEqual(large)
  })
  test('preserves ID types and avoids path collisions', () => {
    expect(encodeRecord(BSON.serialize({ _id: '1' })).key).not.toBe(encodeRecord(BSON.serialize({ _id: 1 })).key)
    expect(segment('a/b')).not.toBe(segment('a_b'))
    expect(segment('a/b')).not.toContain('/')
  })
  test('reads documents across arbitrary stream boundaries', async () => {
    const bytes = Buffer.concat([raw, raw])
    const chunks = Array.from({ length: Math.ceil(bytes.length / 7) }, (_, i) => bytes.subarray(i * 7, i * 7 + 7))
    const records = []
    for await (const record of readBson(Readable.from(chunks))) records.push(record)
    expect(records).toEqual([raw, raw])
  })
  test('fails closed for truncated backups', async () => {
    await expect((async () => { for await (const record of readBson(Readable.from([raw.subarray(0, raw.length - 1)]))) void record })()).rejects.toThrow('TRUNCATED')
  })
  test('copies inactive/orphan tenant databases without copying unrelated applications', () => {
    expect(selectDatabases('test', ['talio_company_inactive'], ['MIRA', 'admin', 'talio_company_orphan', 'talio_media_validation_123', 'mushroom_world_group']))
      .toEqual(['mushroom_world_group', 'talio_company_inactive', 'talio_company_orphan', 'talio_superadmin', 'test'])
  })
  test('rejects unsafe runs and system database sources', () => {
    expect(() => assertRunId('../escape')).toThrow()
    expect(() => selectDatabases('admin', [], [])).toThrow()
    expect(assertRunId('talio-20261003-a1')).toBe('talio-20261003-a1')
  })
  test('limits concurrent verification while preserving result order', async () => {
    let active = 0, peak = 0
    const results = await mapLimit([1, 2, 3, 4, 5], 2, async value => {
      active++; peak = Math.max(peak, active)
      await new Promise(resolve => setImmediate(resolve))
      active--
      return value * 2
    })
    expect(results).toEqual([2, 4, 6, 8, 10])
    expect(peak).toBe(2)
    await expect(mapLimit([1], 0, () => 1)).rejects.toThrow('INVALID_CONCURRENCY')
  })
  test('reconstructs independent GridFS checksums without changing binary bytes', async () => {
    const chunk = (id, n, data) => BSON.serialize({ _id: new ObjectId(), files_id: id, n, data: new Binary(Buffer.from(data)) })
    const input = [chunk('one', 0, [0, 255]), chunk('one', 1, [1]), chunk('two', 0, [42])]
    const result = await gridfsDigests(input)
    expect(result.get('"one"')).toEqual({ valid: true, length: 3, sha256: sha256(Buffer.from([0, 255, 1])) })
    expect(result.get('"two"')).toEqual({ valid: true, length: 1, sha256: sha256(Buffer.from([42])) })
    expect((await gridfsDigests([chunk('one', 1, [1])])).get('"one"').valid).toBe(false)
    await expect(gridfsDigests([chunk('one', 0, [1]), chunk('two', 0, [2]), chunk('one', 1, [3])])).rejects.toThrow('NONCONTIGUOUS_SOURCE_MEDIA')
  })
  test('compares native Firestore timestamps, bytes, and unordered map fields without type loss', () => {
    const date = new Date('2026-01-01T12:00:00.123Z')
    const source = { date, bytes: Buffer.from([1, 2]), a: [NaN, Infinity, '1', 1, null] }
    const cloud = { a: [NaN, Infinity, '1', 1, null], bytes: new Uint8Array([1, 2]), date: { toDate: () => date } }
    expect(canonicalProjection(source)).toBe(canonicalProjection(cloud))
    expect(canonicalProjection({ id: 1 })).not.toBe(canonicalProjection({ id: '1' }))
    expect(canonicalProjection({ a: NaN })).not.toBe(canonicalProjection({ a: null }))
  })
})
