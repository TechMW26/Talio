'use strict'

// Bodies remain in the protected NDJSON files. Only routing, offsets and hashes
// live in memory; no temporary copies or provider calls are needed.
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { canonical, sha256, validateEntry } = require('./core.cjs')

const fingerprint = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':')
const statFile = filename => fs.statSync(filename, { bigint: true })

class IndexedArchive {
  constructor({ maxOpenFiles = 16 } = {}) {
    if (!Number.isInteger(maxOpenFiles) || maxOpenFiles < 1 || maxOpenFiles > 64) throw new Error('INVALID_ARCHIVE_FILE_BOUND')
    this.index = new Map()
    this.files = []
    this.handles = new Map()
    this.maxOpenFiles = maxOpenFiles
    this.closed = false
  }
  get size() { return this.index.size }
  checkOpen() { if (this.closed) throw new Error('ARCHIVE_INDEX_CLOSED') }
  checkFile(file, fd) {
    if (fingerprint(statFile(file.filename)) !== file.fingerprint || (fd !== undefined && fingerprint(fs.fstatSync(fd, { bigint: true })) !== file.fingerprint)) throw new Error('ARCHIVE_FILE_CHANGED')
  }
  handle(file) {
    this.checkOpen()
    let fd = this.handles.get(file)
    if (fd !== undefined) this.handles.delete(file)
    else {
      if (this.handles.size >= this.maxOpenFiles) {
        const [old, oldFd] = this.handles.entries().next().value
        fs.closeSync(oldFd); this.handles.delete(old)
      }
      fd = fs.openSync(file.filename, 'r')
    }
    this.handles.set(file, fd)
    this.checkFile(file, fd)
    return fd
  }
  has(key) { this.checkOpen(); return this.index.has(key) }
  entryBytes(key) { this.checkOpen(); return this.index.get(key)?.length || 0 }
  get(key) {
    this.checkOpen()
    const descriptor = this.index.get(key)
    if (!descriptor) return undefined
    const fd = this.handle(descriptor.file)
    const bytes = Buffer.allocUnsafe(descriptor.length)
    let read = 0
    while (read < bytes.length) {
      const count = fs.readSync(fd, bytes, read, bytes.length - read, descriptor.offset + read)
      if (!count) throw new Error('ARCHIVE_FILE_CHANGED')
      read += count
    }
    const entry = validateEntry(JSON.parse(bytes.toString('utf8')))
    if (entry.path !== key || sha256(canonical(entry)) !== descriptor.hash) throw new Error('ARCHIVE_INDEX_PAYLOAD_CHANGED')
    this.checkFile(descriptor.file, fd)
    return entry
  }
  keys() { this.checkOpen(); return this.index.keys() }
  *values() { for (const key of this.keys()) yield this.get(key) }
  *entries() { for (const key of this.keys()) yield [key, this.get(key)] }
  [Symbol.iterator]() { return this.entries() }
  forEach(callback, thisArg) { for (const [key, value] of this) callback.call(thisArg, value, key, this) }
  assertUnchanged() { this.checkOpen(); for (const file of this.files) this.checkFile(file, this.handles.get(file)) }
  close() { for (const fd of this.handles.values()) fs.closeSync(fd); this.handles.clear(); this.closed = true }
}

async function loadIndexedEntries(directory, manifest, { maxOpenFiles = 16, maxLineBytes = 64 * 1024 * 1024, onProgress } = {}) {
  if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes < 1 || maxLineBytes > 64 * 1024 * 1024) throw new Error('INVALID_ARCHIVE_LINE_BOUND')
  const archive = new IndexedArchive({ maxOpenFiles })
  try {
    for (const collection of manifest.collections || []) {
      if (!/^[a-f0-9]{64}\.ndjson$/.test(collection.file)) throw new Error('INVALID_ARCHIVE_FILENAME')
      const filename = path.join(directory, collection.file), stat = statFile(filename)
      if (!stat.isFile()) throw new Error('INVALID_ARCHIVE_FILE')
      const file = { filename, fingerprint: fingerprint(stat) }
      archive.files.push(file)
      let offset = 0, pending = Buffer.alloc(0), documents = 0, missingParents = 0, previous = null, sorted = true
      let hash = createHash('sha256')
      const keys = []
      const accept = bytes => {
        const lineOffset = offset
        offset += bytes.length + 1
        // CRLF is legal; the byte index retains the CR for exact offset lengths.
        if (!bytes.length || (bytes.length === 1 && bytes[0] === 13)) return
        if (bytes.length > maxLineBytes) throw new Error('ARCHIVE_ENTRY_EXCEEDS_READ_BOUND')
        const entry = validateEntry(JSON.parse(bytes.toString('utf8')))
        if (archive.index.has(entry.path)) throw new Error('DUPLICATE_ARCHIVE_PATH')
        const body = canonical(entry)
        archive.index.set(entry.path, { file, offset: lineOffset, length: bytes.length, hash: sha256(body) })
        keys.push(entry.path)
        if (previous !== null && previous.localeCompare(entry.path) > 0) sorted = false
        previous = entry.path
        hash.update(body); hash.update('\n')
        if (entry.exists) documents++; else missingParents++
      }
      for await (const chunk of fs.createReadStream(filename, { highWaterMark: 256 * 1024 })) {
        const buffer = pending.length ? Buffer.concat([pending, chunk]) : chunk
        let start = 0, newline
        while ((newline = buffer.indexOf(10, start)) !== -1) {
          accept(buffer.subarray(start, newline)); start = newline + 1
        }
        pending = Buffer.from(buffer.subarray(start))
        if (pending.length > maxLineBytes) throw new Error('ARCHIVE_ENTRY_EXCEEDS_READ_BOUND')
      }
      if (pending.length) accept(pending)
      archive.checkFile(file)
      if (!sorted) {
        // The manifest hashes sorted canonical bodies, not original line order.
        // Re-read only an unsorted collection; even then retain no bodies.
        hash = createHash('sha256')
        for (const key of keys.sort((a, b) => a.localeCompare(b))) { hash.update(canonical(archive.get(key))); hash.update('\n') }
      }
      const summary = { documents, missingParents, sha256: hash.digest('hex') }
      if (JSON.stringify(summary) !== JSON.stringify(collection.summary)) throw new Error('COLLECTION_ARCHIVE_MISMATCH')
      onProgress?.({ collections: archive.files.length, archiveEntries: archive.size })
    }
    archive.assertUnchanged()
    return archive
  } catch (error) { archive.close(); throw error }
}

// Both the entry count and serialized payload budget bound retained batch data.
function *archiveBatches(entries, { maxEntries = 64, maxBytes = 16 * 1024 * 1024 } = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('INVALID_ARCHIVE_BATCH_BOUND')
  let batch = [], bytes = 0
  for (const key of entries.keys()) {
    const length = typeof entries.entryBytes === 'function' ? entries.entryBytes(key) : 0
    if (batch.length && (batch.length >= maxEntries || (length && bytes + length > maxBytes))) { yield batch; batch = []; bytes = 0 }
    const entry = entries.get(key)
    batch.push(entry); bytes += length || Buffer.byteLength(JSON.stringify(entry))
    if (batch.length >= maxEntries || bytes >= maxBytes) { yield batch; batch = []; bytes = 0 }
  }
  if (batch.length) yield batch
}

module.exports = { loadIndexedEntries, IndexedArchive, archiveBatches }
