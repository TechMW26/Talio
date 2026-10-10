const { plan, applicationModule } = require('../../scripts/mongodb-migration/acceptance.cjs')
const path = require('node:path')
const env = { MONGODB_URI: 'mongodb://127.0.0.1:27017', MONGODB_DATABASE: 'talio_test' }
const flags = ['--host', '127.0.0.1', '--database', 'talio_test']

test('native acceptance remains read-only by default with explicitly matched target', () => {
  expect(plan(env, flags)).toEqual({ host: '127.0.0.1', databaseName: 'talio_test', execute: false })
  expect(() => plan(env, [])).toThrow('Explicit --host')
  expect(() => plan(env, ['--host', 'wrong.example', '--database', 'talio_test'])).toThrow('EXPLICITLY_ALLOWED')
})

test('acceptance writes require both execute flag and independent environment confirmation', () => {
  expect(() => plan(env, [...flags, '--execute'])).toThrow('MONGODB_ACCEPTANCE_CONFIRM')
  expect(plan({ ...env, MONGODB_ACCEPTANCE_CONFIRM: 'isolated-temporary-records' }, [...flags, '--execute']).execute).toBe(true)
  expect(() => plan({ ...env, MONGODB_DATABASE: 'admin' }, ['--host', '127.0.0.1', '--database', 'admin'])).toThrow('EXPLICITLY_ALLOWED')
})

test('acceptance target flags cannot be duplicated, omitted or shadowed by unknown arguments', () => {
  for (const invalid of [[...flags, '--host', 'wrong.example'], ['--host', '--database', 'talio_test'], [...flags, '--production'], [...flags, '--execute', '--execute']]) {
    expect(() => plan(env, invalid)).toThrow()
  }
})

test('acceptance loader resolves actual application adapters without network calls', () => {
  expect(typeof applicationModule(path.resolve(__dirname, '../../lib/platform/mongoStore.server.js')).createMongoDatabase).toBe('function')
  expect(typeof applicationModule(path.resolve(__dirname, '../../lib/platform/mongoFirestoreFacade.server.js')).createMongoFirestoreFacade).toBe('function')
})
