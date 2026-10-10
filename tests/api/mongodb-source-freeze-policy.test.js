const { generateSourceFreezePolicy, generateSourcePolicyRestoration, comparablePolicy, validPermission, PROJECT, EXPECTED } = require('../../scripts/mongodb-migration/source-freeze-policy.cjs')
const clone = value => JSON.parse(JSON.stringify(value))
function fixture() {
  const reads = ['datastore.entities.get', 'datastore.entities.list', 'datastore.databases.get']
  const iam = ['resourcemanager.projects.getIamPolicy', 'resourcemanager.projects.setIamPolicy']
  const roleDescriptions = {
    'roles/owner': { name: 'roles/owner', includedPermissions: [...reads, ...iam, 'datastore.entities.create', 'datastore.entities.update', 'datastore.entities.delete'] },
    'roles/resourcemanager.projectIamAdmin': { name: 'roles/resourcemanager.projectIamAdmin', includedPermissions: iam },
    'roles/datastore.viewer': { name: 'roles/datastore.viewer', includedPermissions: reads },
    'roles/firestore.serviceAgent': { name: 'roles/firestore.serviceAgent', includedPermissions: ['storage.objects.create', 'storage.objects.delete', 'storage.objects.get', 'storage.objects.list', 'storage.buckets.get'] },
  }
  const original = { version: 3, etag: 'protected-current-etag', bindings: Object.entries(EXPECTED).map(([role, member]) => ({ role, members: [member] })), auditConfigs: [{ service: 'allServices', auditLogConfigs: [{ logType: 'DATA_WRITE' }] }], unrelatedMetadata: { unchanged: true } }
  return { original, options: { projectId: PROJECT, roleDescriptions } }
}
test('pure plan makes only exact project read-only grant changes without losing rollback or unrelated data', () => {
  const { original, options } = fixture(), before = clone(original)
  const plan = generateSourceFreezePolicy(original, options)
  expect(original).toEqual(before)
  expect(plan.originalBackup).toEqual(original)
  expect(plan.policy).toMatchObject({ etag: original.etag, version: original.version, auditConfigs: original.auditConfigs, unrelatedMetadata: original.unrelatedMetadata })
  expect(plan.policy.bindings).toEqual([
    { role: 'roles/datastore.viewer', members: [EXPECTED['roles/owner'], EXPECTED['roles/datastore.user'], EXPECTED['roles/firebaserules.system']] },
    { role: 'roles/resourcemanager.projectIamAdmin', members: [EXPECTED['roles/owner']] },
    { role: 'roles/firestore.serviceAgent', members: [EXPECTED['roles/firestore.serviceAgent']] },
  ])
  expect(plan.report).toMatchObject({ policyApplied: false, effectiveWriteFenceVerified: false, authorityExpanded: false, providerOperations: 0 })
  expect(plan.requirements.mustDenyPermissions).toEqual(expect.arrayContaining(['datastore.entities.create', 'datastore.entities.delete', 'datastore.entities.update', 'datastore.databases.bulkDelete']))
  expect(plan.requirements.negativeProbeMustNotCommitSourceData).toBe(true)
  expect(plan.requirements.requiredOperationalChecks).toContain('client-security-rules-deny-source-writes')
})
test.each([
  ['wrong project', (f) => { f.options.projectId = 'other-project' }],
  ['additional role', (f) => { f.original.bindings.push({ role: 'roles/editor', members: ['user:someone@example.com'] }) }],
  ['additional owner', (f) => { f.original.bindings[0].members.push('user:someone@example.com') }],
  ['other data SA', (f) => { f.original.bindings[1].members = ['serviceAccount:other@example.com'] }],
  ['condition', (f) => { f.original.bindings[1].condition = { expression: 'true' } }],
  ['unexpected binding field', (f) => { f.original.bindings[1].unknown = true }],
  ['duplicate role', (f) => { f.original.bindings[1] = clone(f.original.bindings[0]) }],
  ['missing etag', (f) => { delete f.original.etag }],
  ['unsupported policy version', (f) => { f.original.version = 2 }],
])('fails closed without attempting to erase unexpected grants: %s', (name, mutate) => {
  const f = fixture(); mutate(f)
  expect(() => generateSourceFreezePolicy(f.original, f.options)).toThrow()
})
test.each(['roles/datastore.viewer', 'roles/resourcemanager.projectIamAdmin', 'roles/firestore.serviceAgent'])('requires verified output role permissions and rejects data writes even on friendly named role %s', role => {
  const f = fixture()
  f.options.roleDescriptions[role].includedPermissions.push('datastore.entities.update')
  expect(() => generateSourceFreezePolicy(f.original, f.options)).toThrow('NON_READ_DATASTORE_PERMISSION')
})
test('requires fresh role description names, read capability, and rollback IAM without expanding Owner authority', () => {
  const missing = fixture(); delete missing.options.roleDescriptions['roles/firestore.serviceAgent']
  expect(() => generateSourceFreezePolicy(missing.original, missing.options)).toThrow('ROLE_PERMISSION_DESCRIPTION')
  const renamed = fixture(); renamed.options.roleDescriptions['roles/datastore.viewer'].name = 'roles/editor'
  expect(() => generateSourceFreezePolicy(renamed.original, renamed.options)).toThrow('ROLE_PERMISSION_DESCRIPTION')
  const expanded = fixture(); expanded.options.roleDescriptions['roles/resourcemanager.projectIamAdmin'].includedPermissions.push('iam.unexpected.newAuthority')
  expect(() => generateSourceFreezePolicy(expanded.original, expanded.options)).toThrow('MUST_NOT_EXPAND')
  const rollback = fixture(); rollback.options.roleDescriptions['roles/resourcemanager.projectIamAdmin'].includedPermissions.pop()
  expect(() => generateSourceFreezePolicy(rollback.original, rollback.options)).toThrow('ROLLBACK_IAM_AUTHORITY')
  const unreadable = fixture(); unreadable.options.roleDescriptions['roles/datastore.viewer'].includedPermissions.pop()
  expect(() => generateSourceFreezePolicy(unreadable.original, unreadable.options)).toThrow('EXPORT_READ_PERMISSION')
})
test('rollback uses the fresh etag, permits server binding/member reordering, and never loses concurrent changes', () => {
  const f = fixture(), plan = generateSourceFreezePolicy(f.original, f.options)
  const active = { ...clone(plan.policy), etag: 'fresh-post-freeze-etag' }
  active.bindings.reverse(); active.bindings.forEach(binding => binding.members.reverse())
  expect(comparablePolicy(active)).toBe(comparablePolicy(plan.policy))
  expect(generateSourcePolicyRestoration(f.original, active, f.options)).toEqual({ ...f.original, etag: active.etag })
  active.bindings.push({ role: 'roles/viewer', members: ['user:another@example.com'] })
  expect(() => generateSourcePolicyRestoration(f.original, active, f.options)).toThrow('MANUAL_REVIEW_REQUIRED')
})
test('frozen plan and retained backup are independent copies', () => {
  const f = fixture(), plan = generateSourceFreezePolicy(f.original, f.options)
  plan.policy.auditConfigs[0].service = 'changed'
  expect(f.original.auditConfigs[0].service).toBe('allServices')
  expect(plan.originalBackup.auditConfigs[0].service).toBe('allServices')
})
test('accepts real vendor namespaces without weakening read-only or authority subset checks', () => {
  const f = fixture(), vendor = ['cloudonefs.isiloncloud.com/clusters.get', 'cloudvolumesgcp-api.netapp.com/volumes.list', 'iam.googleapis.com/workforcePools.get']
  f.options.roleDescriptions['roles/datastore.viewer'].includedPermissions.push(...vendor)
  f.options.roleDescriptions['roles/owner'].includedPermissions.push(...vendor)
  const plan = generateSourceFreezePolicy(f.original, f.options)
  expect(plan.report.authorityExpanded).toBe(false)
  const { sha256, canonical } = require('../../scripts/mongodb-migration/core.cjs')
  expect(plan.report.originalPolicyHash).toBe(sha256(canonical(f.original)))
  expect(plan.report.proposedPolicyHash).toBe(sha256(canonical(plan.policy)))
  for (const [name, description] of Object.entries(f.options.roleDescriptions)) expect(plan.report.roleDescriptionHashes[name]).toBe(sha256(canonical(description)))
})
test('never grants broader Project Viewer even when its newer permissions are not in Owner', () => {
  const f = fixture()
  f.options.roleDescriptions['roles/viewer'] = { name: 'roles/viewer', includedPermissions: ['compute.newerFeature.get', 'dataplex.newerFeature.get', 'aiplatform.newerFeature.get'] }
  const plan = generateSourceFreezePolicy(f.original, f.options)
  expect(plan.policy.bindings.some(binding => binding.role === 'roles/viewer')).toBe(false)
  expect(plan.report.roleDescriptionHashes['roles/viewer']).toBeUndefined()
  expect(plan.policy.bindings.filter(binding => binding.role === 'roles/datastore.viewer')).toHaveLength(1)
  const owner = new Set(f.options.roleDescriptions['roles/owner'].includedPermissions)
  for (const binding of plan.policy.bindings.filter(binding => binding.members.includes(EXPECTED['roles/owner']))) {
    for (const permission of f.options.roleDescriptions[binding.role].includedPermissions) expect(owner.has(permission)).toBe(true)
  }
})
test('rejects Datastore Viewer permissions missing from current Owner even when read-only', () => {
  const f = fixture()
  f.options.roleDescriptions['roles/datastore.viewer'].includedPermissions.push('datastore.newerFeature.get')
  expect(() => generateSourceFreezePolicy(f.original, f.options)).toThrow('HUMAN_ROLE_CHANGE_MUST_NOT_EXPAND_EXISTING_OWNER_AUTHORITY')
})
test.each(['datastore.googleapis.com/entities.update', 'datastore.googleapis.com/datastore.entities.delete', 'firestore.googleapis.com/entities.create', 'firestore.databases.update', 'other.googleapis.com/datastore.entities.update', 'DataStore.entities.update', 'DataStore.googleapis.com/entities.delete', 'datastore.other-vendor.com/entities.create'])('rejects non-read data permissions even when namespaced: %s', permission => {
  const f = fixture(); f.options.roleDescriptions['roles/firestore.serviceAgent'].includedPermissions.push(permission)
  expect(() => generateSourceFreezePolicy(f.original, f.options)).toThrow('NON_READ_DATASTORE_PERMISSION')
})
test.each(['datastore.entities.*', 'datastore.googleapis.com/*', 'datastore.googleapis.com//entities.update', 'datastore.googleapis.com/../entities.update', 'cloudonefs.isiloncloud.com/clusters.get?token=x', 'cloudonefs.isiloncloud.com/clusters.get extra', 'cloudonefs.isiloncloud.com\\clusters.get', '/entities.update', 'singleword', 'datastore..entities.get', 'bad-.googleapis.com/entities.get', '-bad.googleapis.com/entities.get'])('rejects malformed or wildcard permissions: %s', permission => {
  expect(validPermission(permission)).toBe(false)
  const f = fixture(); f.options.roleDescriptions['roles/owner'].includedPermissions.push(permission)
  expect(() => generateSourceFreezePolicy(f.original, f.options)).toThrow('ROLE_PERMISSION_DESCRIPTION')
})
test('generator runs as a portable single file with only built-in dependencies', () => {
  const vm = require('node:vm'), fs = require('node:fs')
  const source = fs.readFileSync(require.resolve('../../scripts/mongodb-migration/source-freeze-policy.cjs'), 'utf8'), sandbox = { module: { exports: {} }, require: name => { if (name !== 'node:crypto') throw new Error('nonportable import'); return require(name) }, Buffer }
  vm.runInNewContext(source, sandbox)
  const f = fixture()
  const vmInput = vm.runInNewContext(`(${JSON.stringify(f)})`, sandbox)
  expect(sandbox.module.exports.generateSourceFreezePolicy(vmInput.original, vmInput.options).report.originalPolicyHash).toBe(generateSourceFreezePolicy(f.original, f.options).report.originalPolicyHash)
})
