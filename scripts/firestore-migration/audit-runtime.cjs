#!/usr/bin/env node
'use strict'

// A completion gate, not a claim that replacing import strings migrates queries.
// This deliberately includes the legacy model registry and raw collection paths.
const fs = require('node:fs')
const path = require('node:path')
const ROOT = path.resolve(__dirname, '../..')
const patterns = {
  driverImport: /(?:from\s*|require\(\s*|import\(\s*)['"](?:mongoose|mongodb)['"]/,
  legacyConnection: /(?:from\s*|require\(\s*|import\(\s*)['"][^'"]*(?:\/mongodb(?:Native)?|\/tenantDb|\/superadminDb|\/gridfs)(?:\.js)?['"]/,
  legacyModels: /(?:from\s*|require\(\s*|import\(\s*)['"][^'"]*(?:\/tenantModels|\/models\/)[^'"]*['"]/,
  modelAuth: /\bgetAuthAndModels\s*\(/,
  aggregation: /\.aggregate\s*\(/,
  populate: /\.populate\s*\(/,
  legacyTransaction: /\.startSession\s*\(/,
  changeStream: /\.watch\s*\(/,
}

function walk(directory) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => {
    if (['node_modules', '.next', '.git'].includes(item.name)) return []
    const target = path.join(directory, item.name)
    return item.isDirectory() ? walk(target) : /\.(?:js|jsx|ts|tsx|cjs|mjs)$/.test(item.name) ? [target] : []
  })
}

function audit() {
  const files = [...new Set(['app', 'lib', 'models'].flatMap(dir => walk(path.join(ROOT, dir))))]
  const findings = []
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n'), kinds = {}
    lines.forEach((line, index) => {
      for (const [kind, pattern] of Object.entries(patterns)) {
        // This one native Firestore aggregation is the Admin SDK count/sum API,
        // not a Mongo pipeline. Keep all other aggregation call sites audited.
        const nativeAggregate = kind === 'aggregation' && path.relative(ROOT, file) === 'lib/platform/firestoreSuperadmin.server.js' && line.includes('records.aggregate(values).get()')
        if (!nativeAggregate && pattern.test(line)) (kinds[kind] ||= []).push(index + 1)
      }
    })
    if (Object.keys(kinds).length) findings.push({ file: path.relative(ROOT, file), kinds })
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const dependencies = ['mongoose', 'mongodb', 'mongodb-memory-server'].filter(name => pkg.dependencies?.[name] || pkg.devDependencies?.[name])
  const counts = Object.fromEntries(Object.keys(patterns).map(kind => [kind, findings.reduce((sum, item) => sum + (item.kinds[kind]?.length || 0), 0)]))
  return { complete: findings.length === 0 && dependencies.length === 0, sourceFilesScanned: files.length, filesRequiringConversion: findings.length, dependencies, counts, findings }
}

if (require.main === module) {
  const report = audit()
  console.log(JSON.stringify(process.argv.includes('--summary') ? { ...report, findings: undefined } : report, null, 2))
  if (process.argv.includes('--check') && !report.complete) process.exitCode = 1
}
module.exports = { audit }
