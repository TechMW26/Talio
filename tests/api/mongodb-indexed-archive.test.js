const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { loadIndexedEntries, archiveBatches } = require('../../scripts/mongodb-migration/indexed-archive.cjs')
const { loadEntries, planMongo, importMongo } = require('../../scripts/mongodb-migration/migrate.cjs')
const { sha256, collectionSummary, materializeRecord } = require('../../scripts/mongodb-migration/core.cjs')
const { pack, encodeApplicationRecord } = require('../../lib/platform/firestoreCodec.cjs')

const entry = (name, value, exists = true) => {
  const fields = exists ? pack({ value: { stringValue: 'synthetic-value' } }) : null
  return { path: name, exists, fields, sha256: sha256(JSON.stringify(fields)), updateTime: null, ...(value === undefined ? {} : { application: pack(value) }) }
}
const recordPath = 'talioDatasets/live-example/databases/talio_company_example/collections/users/records/123456789012345678901234'

describe('bounded read-only Mongo archive index', () => {
  let directory
  beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'talio-indexed-test-')) })
  afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }) })
  async function fixture(groups, { crlf = false, finalNewline = true } = {}) {
    const collections = []
    for (let index = 0; index < groups.length; index++) {
      const file = `${sha256(`fixture-${index}`)}.ndjson`, delimiter = crlf ? '\r\n' : '\n'
      await fs.writeFile(path.join(directory, file), groups[index].map(value => JSON.stringify(value)).join(delimiter) + (finalNewline ? delimiter : ''))
      collections.push({ path: `collection${index}`, file, summary: collectionSummary(groups[index]) })
    }
    return { run: 'mongo-indexed-test', complete: true, collections }
  }
  test('matches eager reader for Unicode, CRLF, unsorted paths, missing parents and Map iteration', async () => {
    const manifest = await fixture([[entry('root/é', { unicode: 'Δ😀\n' }), entry('root/a'), entry('root/absent', undefined, false)], [entry('other/z')]], { crlf: true, finalNewline: false })
    const expected = await loadEntries(directory, manifest)
    const index = await loadIndexedEntries(directory, manifest, { maxOpenFiles: 1 })
    try {
      expect(index.size).toBe(4)
      expect([...index.keys()]).toEqual([...expected.keys()])
      expect([...index]).toEqual([...expected])
      expect([...index.values()]).toEqual([...expected.values()])
      expect(index.has('root/a')).toBe(true)
      expect(index.get('not/found')).toBeUndefined()
      expect(index.entryBytes('root/é')).toBe(Buffer.byteLength(JSON.stringify(expected.get('root/é'))) + 1)
      const visited = []
      index.forEach((value, key, map) => { expect(map).toBe(index); visited.push([key, value]) })
      expect(visited).toEqual([...expected])
      expect(index.handles.size).toBeLessThanOrEqual(1)
      expect([...index.index.values()].every(descriptor => !descriptor.fields && !descriptor.application)).toBe(true)
    } finally { index.close() }
    expect(() => index.get('root/a')).toThrow('CLOSED')
    expect(index.handles.size).toBe(0)
  })
  test('checks raw checksums, canonical application projections, duplicate paths, unsafe filenames and bounds', async () => {
    const original = entry('root/a', { projection: 'original' })
    const manifest = await fixture([[original]])
    const file = path.join(directory, manifest.collections[0].file)
    await fs.writeFile(file, JSON.stringify({ ...original, sha256: 'broken' }))
    await expect(loadIndexedEntries(directory, manifest)).rejects.toThrow('CHECKSUM')
    await fs.writeFile(file, JSON.stringify({ ...original, application: pack({ projection: 'changed' }) }))
    await expect(loadIndexedEntries(directory, manifest)).rejects.toThrow('COLLECTION_ARCHIVE_MISMATCH')
    await fs.writeFile(file, `${JSON.stringify(original)}\n${JSON.stringify(original)}\n`)
    await expect(loadIndexedEntries(directory, manifest)).rejects.toThrow('DUPLICATE')
    await expect(loadIndexedEntries(directory, { collections: [{ file: '../outside.ndjson' }] })).rejects.toThrow('FILENAME')
    await fs.writeFile(file, JSON.stringify(original))
    await expect(loadIndexedEntries(directory, manifest, { maxLineBytes: 20 })).rejects.toThrow('READ_BOUND')
    await expect(loadIndexedEntries(directory, manifest, { maxOpenFiles: 0 })).rejects.toThrow('FILE_BOUND')
  })
  test('refuses archive replacement, in-place mutation and removed files after indexing', async () => {
    const manifest = await fixture([[entry('root/a')]])
    const file = path.join(directory, manifest.collections[0].file)
    const index = await loadIndexedEntries(directory, manifest)
    try {
      index.get('root/a')
      await fs.writeFile(file, JSON.stringify(entry('root/a', { newlyAdded: 'changed' })))
      expect(() => index.get('root/a')).toThrow('ARCHIVE_FILE_CHANGED')
      expect(() => index.assertUnchanged()).toThrow('ARCHIVE_FILE_CHANGED')
    } finally { index.close() }
    await fixture([[entry('root/a')]])
    const replacementIndex = await loadIndexedEntries(directory, manifest)
    try {
      replacementIndex.get('root/a')
      await fs.rename(file, `${file}.retained`)
      await fs.copyFile(`${file}.retained`, file)
      expect(() => replacementIndex.get('root/a')).toThrow('ARCHIVE_FILE_CHANGED')
      await fs.unlink(file)
      expect(() => replacementIndex.assertUnchanged()).toThrow()
    } finally { replacementIndex.close() }
  })
  test('preserves overflow parts and exact plan/import/verify semantics with a lazy source', async () => {
    const encoded = encodeApplicationRecord({ _id: '123456789012345678901234', nested: [[1, 2]], bytes: Buffer.from([0, 255]) })
    const manifest = await fixture([[entry('talioDatasets/live-example', { tenants: [] })], [entry(recordPath, encoded.envelope)], encoded.parts.map(part => entry(`${recordPath}/parts/${part.id}`, part.value))])
    const index = await loadIndexedEntries(directory, manifest)
    try {
      const eager = await loadEntries(directory, manifest)
      expect(planMongo(index, manifest, ['live-example'])).toEqual(planMongo(eager, manifest, ['live-example']))
      expect(materializeRecord(index.get(recordPath), index, 'live-example').parts).toEqual(encoded.parts)
      const banks = new Map()
      const matches = (document, filter) => Object.entries(filter).every(([field, value]) => value && typeof value === 'object' && '$in' in value ? value.$in.includes(document[field]) : document[field] === value)
      const db = { collection(name) {
        if (!banks.has(name)) banks.set(name, new Map())
        const bank = banks.get(name)
        async function updateOne(filter, update, options = {}) {
          const saved = [...bank.values()].find(document => matches(document, filter))
          if (saved) Object.assign(saved, update.$set || {})
          else if (options.upsert) bank.set(filter._id, { ...filter, ...update.$setOnInsert, ...update.$set })
        }
        return { createIndex: async () => 'index', updateOne, findOne: async filter => [...bank.values()].find(document => matches(document, filter)) || null, find: filter => ({ toArray: async () => [...bank.values()].filter(document => matches(document, filter)) }), countDocuments: async filter => [...bank.values()].filter(document => matches(document, filter)).length, bulkWrite: async operations => { for (const operation of operations) await updateOne(operation.updateOne.filter, operation.updateOne.update, { upsert: operation.updateOne.upsert }) } }
      } }
      await importMongo(db, index, manifest, 'live-example')
      expect(await importMongo(db, index, manifest, 'live-example', true)).toMatchObject({ rawCount: 3, recordCount: 1, verified: true })
      const saved = [...banks.get('talio_records').values()][0]
      saved.parts.push({ id: 'extra', value: { bytes: Buffer.from('not allowed') } })
      await expect(importMongo(db, index, manifest, 'live-example', true)).rejects.toThrow('PART_MISMATCH')
      saved.parts.pop()
      banks.get('talio_catalogs').set('unexpected', { _id: 'unexpected' })
      await expect(importMongo(db, index, manifest, 'live-example', true)).rejects.toThrow('TOTAL_COUNT')
    } finally { index.close() }
  })
  test('bounds batches by both count and payload bytes without eager values()', async () => {
    const manifest = await fixture([[entry('root/a', { payload: 'x'.repeat(1000) }), entry('root/b', { payload: 'x'.repeat(1000) }), entry('root/c')]])
    const index = await loadIndexedEntries(directory, manifest)
    try {
      index.values = () => { throw new Error('EAGER_VALUES_FORBIDDEN') }
      const batches = [...archiveBatches(index, { maxEntries: 2, maxBytes: 1400 })]
      expect(batches.map(batch => batch.length)).toEqual([1, 1, 1])
      expect(batches.flat().map(value => value.path)).toEqual(['root/a', 'root/b', 'root/c'])
      expect(() => [...archiveBatches(index, { maxEntries: 0 })]).toThrow('BATCH_BOUND')
    } finally { index.close() }
  })
  test('indexes and traverses a synthetic archive larger than the child heap without retaining bodies', () => {
    const modulePath = path.resolve(__dirname, '../../scripts/mongodb-migration/indexed-archive.cjs')
    const corePath = path.resolve(__dirname, '../../scripts/mongodb-migration/core.cjs')
    const migratePath = path.resolve(__dirname, '../../scripts/mongodb-migration/migrate.cjs')
    const recoverPath = path.resolve(__dirname, '../../scripts/mongodb-migration/recover-baseline.cjs')
    // The child creates only this test's temporary fixture; no real archive or
    // provider is touched. Its 96MiB heap is smaller than the 120MiB input.
    const script = `
      const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto');
      const { loadIndexedEntries } = require(${JSON.stringify(modulePath)});
      const { sha256, canonical } = require(${JSON.stringify(corePath)});
      const { planMongo } = require(${JSON.stringify(migratePath)});
      const { recoverBaseline } = require(${JSON.stringify(recoverPath)});
      (async () => {
        const file = sha256('large-fixture') + '.ndjson', fd = fs.openSync(path.join(process.argv[1], file), 'w');
        const hash = createHash('sha256'), count = 16000, payload = 'x'.repeat(8000);
        for(let n=0;n<count;n++) { const fields={payload}, entry={path:'root/'+String(n).padStart(6,'0'),exists:true,fields,sha256:sha256(JSON.stringify(fields)),updateTime:null}; fs.writeSync(fd,JSON.stringify(entry)+'\\n'); hash.update(canonical(entry)+'\\n'); }
        fs.closeSync(fd);
        const collections=[{path:'root',file,summary:{documents:count,missingParents:0,sha256:hash.digest('hex')}}];
        const index=await loadIndexedEntries(process.argv[1],{collections});
        let seen=0; for(const entry of index.values()) { if(entry.fields.payload.length!==8000) throw Error('bad-body'); seen++; }
        const report=planMongo(index,{run:'mongo-lowheap-fixture'},['live-example']);
        if(report.rawCount!==count) throw Error('bad-plan-count');
        index.assertUnchanged(); index.close();
        const oldRun='mongo-lowheap-seed-old',newRun='mongo-lowheap-seed-new',oldDirectory=path.join(process.argv[1],'.migration-data',oldRun);
        fs.mkdirSync(oldDirectory,{recursive:true});fs.linkSync(path.join(process.argv[1],file),path.join(oldDirectory,file));
        fs.writeFileSync(path.join(oldDirectory,'manifest.json'),JSON.stringify({run:oldRun,complete:false,collections}));
        const seed=await recoverBaseline(process.argv[1],oldRun,newRun);
        console.log(JSON.stringify({seen,planCount:report.rawCount,linked:seed.linkedCompletedCollections,heap:process.memoryUsage().heapUsed}));
      })().catch(error=>{console.error(error.message);process.exitCode=1});
    `
    const result = spawnSync(process.execPath, ['--max-old-space-size=96', '-e', script, directory], { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ seen: 16000, planCount: 16000, linked: 1 })
  }, 65000)
  test('exports and full-field verifies a single collection larger than the child heap', () => {
    const migratePath = path.resolve(__dirname, '../../scripts/mongodb-migration/migrate.cjs')
    const script = `
      const {exportTree}=require(${JSON.stringify(migratePath)});
      (async()=>{
        const count=6000,payloadBytes=24000;
        const refs=Array.from({length:count},(_,index)=>({path:'root/'+String(index).padStart(6,'0'),listCollections:async()=>[]}));
        let calls=0;
        const db={listCollections:async()=>[{path:'root'}],collection:()=>({listDocuments:async()=>[...refs].reverse()}),getAll:async(...batch)=>{calls++;if(batch.some(ref=>ref.fieldMask))throw Error('verification-must-fetch-full');return batch.map(ref=>({ref,exists:true,_fieldsProto:{payload:{stringValue:Buffer.alloc(payloadBytes,65+Number(ref.path.slice(-6))%23).toString()}},updateTime:{seconds:1,nanoseconds:2}})).reverse()}};
        const manifest={run:'mongo-lowheap-source',collections:[]};
        const log=console.log;console.log=()=>{};
        const reports=await exportTree(db,process.argv[1],manifest,false,{batchSize:64});
        const verified=await exportTree(db,process.argv[1],manifest,true,{batchSize:64,reuseUnchanged:true});
        console.log=log;
        if(JSON.stringify(reports)!==JSON.stringify(verified)||reports[0].summary.documents!==count)throw Error('source-summary-mismatch');
        console.log(JSON.stringify({count,logicalPayloadBytes:count*payloadBytes,calls,heapUsed:process.memoryUsage().heapUsed}));
      })().catch(error=>{console.error(error.message);process.exitCode=1});
    `
    const result = spawnSync(process.execPath, ['--max-old-space-size=96', '-e', script, directory], { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ count: 6000, logicalPayloadBytes: 144000000, calls: 188 })
  }, 65000)
})
