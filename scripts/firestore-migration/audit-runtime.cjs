#!/usr/bin/env node
'use strict'

// A completion gate, not a claim that replacing import strings migrates queries.
// This deliberately includes the legacy model registry and raw collection paths.
const fs = require('node:fs')
const path = require('node:path')
const ROOT = path.resolve(__dirname, '../..')
const RUNTIME_DIRECTORIES = ['app', 'lib', 'models', 'components', 'hooks', 'contexts', 'src', 'utils', 'config', 'integrations', 'public', 'desktop-app', 'mobile', 'mobile-app', 'socket-server', 'scripts']
// Explicit offline entrypoints, not a directory exemption. Newly added scripts
// are audited by default, including scripts inside either migration directory.
const OFFLINE_TOOLS = new Set([
  'scripts/firestore-migration/add-root-query-indexes.cjs',
  'scripts/firestore-migration/add-media-query-indexes.cjs',
  'scripts/firestore-migration/add-domain-query-indexes.cjs',
  'scripts/firestore-migration/audit-query-indexes.cjs',
  'scripts/firestore-migration/audit-runtime.cjs',
  'scripts/firestore-migration/backfill-native-projections.cjs',
  'scripts/firestore-migration/configure-local.cjs',
  'scripts/firestore-migration/core.cjs',
  'scripts/firestore-migration/dataset-policy.cjs',
  'scripts/firestore-migration/deploy-field-exemptions.cjs',
  'scripts/firestore-migration/deploy-indexes.cjs',
  'scripts/firestore-migration/extract-embedded-media.cjs',
  'scripts/firestore-migration/materialize.cjs',
  'scripts/firestore-migration/route-legacy-ai-contexts.cjs',
  'scripts/firestore-migration/verify-native.cjs',
  'scripts/mongodb-migration/acceptance.cjs',
  'scripts/mongodb-migration/activate-catalog.cjs',
  'scripts/mongodb-migration/apply-delta.cjs',
  'scripts/mongodb-migration/apply-media-disposition.cjs',
  'scripts/mongodb-migration/archive-queues.cjs',
  'scripts/mongodb-migration/core.cjs',
  'scripts/mongodb-migration/http-acceptance.cjs',
  'scripts/mongodb-migration/indexed-archive.cjs',
  'scripts/mongodb-migration/indexes.cjs',
  'scripts/mongodb-migration/migrate.cjs',
  'scripts/mongodb-migration/media-disposition.cjs',
  'scripts/mongodb-migration/media-inventory.cjs',
  'scripts/mongodb-migration/media-recovery-plan.cjs',
  'scripts/mongodb-migration/probe-source-freeze.cjs',
  'scripts/mongodb-migration/reconcile.cjs',
  'scripts/mongodb-migration/recover-baseline.cjs',
  'scripts/mongodb-migration/restore-media-disposition.cjs',
  'scripts/mongodb-migration/setup-indexes.cjs',
  'scripts/mongodb-migration/verify-media.cjs',
])
const NATIVE_ADAPTERS = {
  driverImport: ['lib/platform/mongo.server.js', 'lib/platform/mongoStore.server.js', 'lib/platform/mongoFirestoreFacade.server.js'],
  legacyTransaction: ['lib/platform/mongoStore.server.js', 'lib/platform/mongoApplication.server.js', 'lib/platform/mongoProvisioning.server.js', 'lib/platform/mongoFirestoreFacade.server.js'],
  aggregation: ['lib/platform/firestoreSuperadmin.server.js', 'lib/platform/mongoMedia.server.js'],
}
const patterns = {
  firestoreImport: /(?:from\s*|require\(\s*|import\(\s*)['"](?:firebase(?:-admin)?\/firestore|@google-cloud\/firestore)(?:\/[^'"]*)?['"]/,
  firestoreNamespace: /\b(?:admin|firebaseAdmin|firebase)\.firestore\s*\(/,
  firestoreForeignSdk: /(?:\b(?:from\s+(?:google\.cloud|firebase_admin)\s+import)[^\n]*\bfirestore\b|\b(?:from|import)\s+(?:google\.cloud\.firestore|firebase_admin\.firestore)|\b(?:FirebaseFirestore|FIRFirestore|Firestore\.firestore)\b|firebase-firestore(?:-compat)?\.js)/,
  firestoreConfiguration: /\bprocess\.env\.FIRESTORE_(?:PROJECT_ID|DATABASE_ID|DATASET|SERVICE_ACCOUNT_JSON)\b/,
  firestoreRest: /(?:firestore\.googleapis\.com|firestore\.mtls\.googleapis\.com)/,
  offlineToolImport: /(?:from\s*|require\(\s*|import\(\s*)['"][^'"]*scripts\/(?:firestore|mongodb)-migration\/[^'"]*['"]/,
  driverImport: /(?:from\s*|require\(\s*|import\(\s*)['"](?:mongoose|mongodb)['"]/,
  legacyConnection: /(?:from\s*|require\(\s*|import\(\s*)['"][^'"]*(?:\/mongodb(?:Native)?|\/tenantDb|\/superadminDb|\/gridfs)(?:\.js)?['"]/,
  legacyModels: /(?:from\s*|require\(\s*|import\(\s*)['"][^'"]*(?:\/tenantModels|\/models\/)[^'"]*['"]/,
  modelAuth: /\bgetAuthAndModels\s*\(/,
  aggregation: /\.aggregate\s*\(/,
  populate: /\.populate\s*\(/,
  legacyTransaction: /\.startSession\s*\(/,
  changeStream: /\.watch\s*\(/,
  offlineToolStartup: /scripts\/(?:firestore|mongodb)-migration\//,
}

function walk(directory) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => {
    if (['node_modules', '.git', 'dist', 'build', 'out', 'target', 'coverage', 'vendor'].includes(item.name) || item.name.startsWith('.next')) return []
    const target = path.join(directory, item.name)
    return item.isDirectory() ? walk(target) : /\.(?:js|jsx|ts|tsx|cjs|mjs|py|sh|kt|swift|dart)$/.test(item.name) ? [target] : []
  })
}

function inspectSource(relative, source) {
  if (OFFLINE_TOOLS.has(relative)) return null
  const lines = source.split('\n'), kinds = {}
  lines.forEach((line, index) => {
    for (const [kind, pattern] of Object.entries(patterns)) {
      if (kind === 'offlineToolStartup') continue // Package lifecycle commands only.
      // Provider-native operations are confined to reviewed platform adapters.
      // Legacy Mongoose models, unscoped databases and route-level native
      // queries remain forbidden; selecting Mongo is not a wildcard waiver.
      const nativeAdapter = NATIVE_ADAPTERS[kind]?.includes(relative) && !(kind === 'driverImport' && line.includes('mongoose'))
      if (!nativeAdapter && pattern.test(line)) (kinds[kind] ||= []).push(index + 1)
    }
  })
  return Object.keys(kinds).length ? { file: relative, kinds } : null
}

function inspectPackageScripts(scripts, file = 'package.json') {
  const entries = scripts || {}
  function invokesOffline(name, seen = new Set()) {
    if (seen.has(name)) return false
    seen.add(name)
    const command = entries[name] || ''
    if (patterns.offlineToolStartup.test(command)) return true
    const references = command.matchAll(/(?:\b(?:npm|pnpm)\s+(?:run|run-script)\s+|\byarn\s+(?:run\s+)?)([\w:-]+)/g)
    for (const match of references) if (invokesOffline(match[1], seen)) return true
    return false
  }
  return Object.keys(entries).filter(name => !/^migration:/.test(name) && invokesOffline(name)).map(name => ({ file, kinds: { offlineToolStartup: [name] } }))
}

function audit() {
  const rootEntrypoints = fs.readdirSync(ROOT, { withFileTypes: true }).filter(item => item.isFile() && /\.(?:js|jsx|ts|tsx|cjs|mjs|py|sh|kt|swift|dart)$/.test(item.name)).map(item => path.join(ROOT, item.name))
  const allFiles = [...new Set([...rootEntrypoints, ...RUNTIME_DIRECTORIES.flatMap(dir => walk(path.join(ROOT, dir)))])]
  const offlineTools = allFiles.map(file => path.relative(ROOT, file)).filter(file => OFFLINE_TOOLS.has(file)).sort()
  const files = allFiles.filter(file => !OFFLINE_TOOLS.has(path.relative(ROOT, file)))
  const findings = files.map(file => inspectSource(path.relative(ROOT, file), fs.readFileSync(file, 'utf8'))).filter(Boolean)
  const packageFiles = ['package.json', ...RUNTIME_DIRECTORIES.map(dir => `${dir}/package.json`)].filter(file => fs.existsSync(path.join(ROOT, file)))
  const dependencies = []
  for (const file of packageFiles) {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'))
    // Migration tools must never become lifecycle hooks or application commands.
    findings.push(...inspectPackageScripts(pkg.scripts, file))
    for (const name of ['mongoose', 'mongodb-memory-server']) if (pkg.dependencies?.[name] || pkg.devDependencies?.[name]) dependencies.push(file === 'package.json' ? name : `${file}:${name}`)
  }
  const counts = Object.fromEntries(Object.keys(patterns).map(kind => [kind, findings.reduce((sum, item) => sum + (item.kinds[kind]?.length || 0), 0)]))
  return { complete: findings.length === 0 && dependencies.length === 0, sourceFilesScanned: files.length, runtimeDirectories: RUNTIME_DIRECTORIES, packageFilesScanned: packageFiles.length, offlineTools, filesRequiringConversion: findings.length, dependencies, counts, findings }
}

if (require.main === module) {
  const report = audit()
  console.log(JSON.stringify(process.argv.includes('--summary') ? { ...report, findings: undefined } : report, null, 2))
  if (process.argv.includes('--check') && !report.complete) process.exitCode = 1
}
module.exports = { audit, inspectSource, inspectPackageScripts, OFFLINE_TOOLS }
