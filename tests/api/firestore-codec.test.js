const { encodeApplicationRecord, decodeApplicationRecord, recordDigest, partIds, applicationRecordKey } = require('../../lib/platform/firestoreCodec.cjs')

const roundTrip = value => {
  const encoded = encodeApplicationRecord(value)
  return { encoded, decoded: decodeApplicationRecord(encoded.envelope, new Map(encoded.parts.map(p => [p.id, p.value]))) }
}

describe('native application Firestore codec without a database driver', () => {
  test('keeps legacy hex IDs and safely maps namespaced job IDs', () => {
    expect(applicationRecordKey('123456789012345678901234')).toBe('123456789012345678901234')
    expect(applicationRecordKey('notification:event-1')).toMatch(/^s_[a-f0-9]{64}$/)
    expect(applicationRecordKey('notification:event-1')).not.toBe(applicationRecordKey('notification:event-2'))
    expect(() => applicationRecordKey('../other')).toThrow('Invalid record ID')
  })
  test('keeps IDs, password hashes, dates and queryable fields unchanged', () => {
    const record = { _id: '123456789012345678901234', password: '$2a$10$alreadyHashed', email: 'person@example.test', role: 'admin', createdAt: new Date('2026-01-02'), photo: Buffer.from([0, 1, 255]) }
    const { encoded, decoded } = roundTrip(record)
    expect(decoded).toEqual(record)
    expect(encoded.parts).toHaveLength(0)
  })
  test('restores nested MIRA table arrays instead of discarding archive-only records', () => {
    const record = { _id: 'chat', messages: [{ cards: [{ rows: [['A', 12], ['B', null]] }] }] }
    const { encoded, decoded } = roundTrip(record)
    expect(decoded).toEqual(record)
    expect(encoded.envelope.overflow.map(p => p.field)).toEqual(['messages'])
    expect(partIds(encoded.envelope)).toEqual(encoded.parts.map(p => p.id))
  })
  test('splits oversized payloads but leaves small fields queryable', () => {
    const record = { _id: 'image', status: 'complete', imageBuffer: Buffer.alloc(2400000, 7) }
    const { encoded, decoded } = roundTrip(record)
    expect(encoded.envelope.data.status).toBe('complete')
    expect(encoded.envelope.data.imageBuffer).toBeUndefined()
    expect(decoded.imageBuffer.equals(record.imageBuffer)).toBe(true)
    expect(recordDigest(decoded)).toBe(recordDigest(record))
  })
  test('preserves special primitives, reserved fields and deep maps', () => {
    let deep = 'value'; for (let i = 0; i < 30; i++) deep = { next: deep }
    const record = { _id: 'deep', deep, __private__: ['present'], missing: undefined, count: 9007199254740993n, number: NaN, zero: -0 }
    const { decoded } = roundTrip(record)
    expect(recordDigest(decoded)).toBe(recordDigest(record))
    expect(Object.is(decoded.zero, -0)).toBe(true)
  })
  test('rejects truncated or modified parts and unsupported custom objects', () => {
    const { envelope, parts } = encodeApplicationRecord({ rows: [[1, 2]] })
    expect(() => decodeApplicationRecord(envelope)).toThrow('Missing')
    expect(() => decodeApplicationRecord(envelope, new Map([[parts[0].id, { bytes: Buffer.from('corrupt') }]]))).toThrow('length mismatch')
    expect(() => encodeApplicationRecord({ regex: /anything/ })).toThrow('convert it explicitly')
  })
  test('does not mutate prototypes when decoding external field names', () => {
    const record = JSON.parse('{"__proto__":{"admin":true},"constructor":"value"}')
    const { decoded } = roundTrip(record)
    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype)
    expect(Object.hasOwn(decoded, '__proto__')).toBe(true)
    expect({}.admin).toBeUndefined()
  })
})
