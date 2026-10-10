'use strict'

// Pure generator only: no credentials, filesystem, provider calls or apply.
// Project allow-policy edits are not, by themselves, an effective source fence.
const { createHash } = require('node:crypto')
const sha256 = value => createHash('sha256').update(value).digest('hex')
// Same canonical packing as the migration core for JSON policy/role data,
// deliberately embedded here so Cloud Shell needs only this one pure file.
function packedJson(value) {
  if (value === undefined) return ['undefined']
  if (value === null) return ['null']
  if (typeof value === 'number' && Number.isFinite(value)) return ['number', Object.is(value, -0) ? '-0' : String(value)]
  if (['string', 'boolean'].includes(typeof value)) return [typeof value, value]
  if (Array.isArray(value)) return ['array', value.map(packedJson)]
  if (value && [Object.prototype, null].includes(Object.getPrototypeOf(value))) return ['object', Object.keys(value).sort().map(key => [key, packedJson(value[key])])]
  throw new Error('JSON_ONLY_SOURCE_POLICY_AND_ROLE_DESCRIPTIONS_REQUIRED')
}
const canonical = value => JSON.stringify(packedJson(value))
const PROJECT = 'talio-hrms'
const HUMAN = 'user:aviraj.sharma@mushroomworldgroup.com'
const DATA = 'serviceAccount:firebase-adminsdk-fbsvc@talio-hrms-d6239.iam.gserviceaccount.com'
const RULES = 'serviceAccount:service-721940480873@firebase-rules.iam.gserviceaccount.com'
const FIRESTORE = 'serviceAccount:service-721940480873@gcp-sa-firestore.iam.gserviceaccount.com'
const EXPECTED = Object.freeze({ 'roles/owner': HUMAN, 'roles/datastore.user': DATA, 'roles/firebaserules.system': RULES, 'roles/firestore.serviceAgent': FIRESTORE })
const OUTPUT_ROLES = Object.freeze(['roles/resourcemanager.projectIamAdmin', 'roles/datastore.viewer', 'roles/firestore.serviceAgent'])
const WRITE_PROBES = Object.freeze(['datastore.entities.create', 'datastore.entities.update', 'datastore.entities.delete', 'datastore.entities.allocateIds', 'datastore.databases.bulkDelete', 'datastore.databases.import', 'datastore.databases.clone', 'datastore.backups.restoreDatabase', 'datastore.databases.update', 'datastore.databases.delete', 'datastore.userCreds.create', 'datastore.userCreds.update'])
const READ_PROBES = Object.freeze(['datastore.entities.get', 'datastore.entities.list', 'datastore.databases.get'])
const plain = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value))
const clone = value => JSON.parse(JSON.stringify(value))
function validPermission(permission) {
  if (typeof permission !== 'string' || permission.length > 512) return false
  const tokens = permission.split('/')
  const dotted = /^[a-zA-Z][a-zA-Z0-9_-]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+$/
  if (tokens.length === 1) return dotted.test(permission)
  return tokens.length === 2 && /^[a-zA-Z](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(tokens[0]) && dotted.test(tokens[1])
}
function sourceDataPermission(permission) {
  const [namespace, suffix] = permission.split('/')
  if (!suffix) return /^(?:datastore|firestore)\./i.test(permission)
  // Namespaced Google service aliases must not sidestep the direct permission
  // guard, including datastore.googleapis.com/datastore.entities.update.
  return /^(?:datastore|firestore)\./i.test(namespace) || /^(?:datastore|firestore)\./i.test(suffix)
}
function comparablePolicy(policy) {
  const value = clone(policy)
  delete value.etag
  value.bindings = value.bindings.map(binding => ({ ...binding, members: [...binding.members].sort() })).sort((left, right) => canonical(left).localeCompare(canonical(right)))
  return canonical(value)
}

function validatePolicy(policy) {
  if (!plain(policy) || typeof policy.etag !== 'string' || !policy.etag.length || policy.etag.length > 1024 || ![1, 3].includes(policy.version) || !Array.isArray(policy.bindings)) throw new Error('EXACT_ETAG_VERSIONED_PROJECT_POLICY_REQUIRED')
  if (policy.bindings.length > 1000 || Buffer.byteLength(JSON.stringify(policy)) > 4 * 1024 * 1024) throw new Error('BOUNDED_SOURCE_POLICY_REQUIRED')
  for (const binding of policy.bindings) {
    if (!plain(binding) || Object.keys(binding).some(key => !['role', 'members'].includes(key)) || typeof binding.role !== 'string' || !Array.isArray(binding.members) || !binding.members.length || new Set(binding.members).size !== binding.members.length || binding.members.some(member => typeof member !== 'string')) throw new Error('UNEXPECTED_OR_CONDITIONAL_SOURCE_BINDING')
  }
}

function validateDescriptions(roleDescriptions) {
  if (!plain(roleDescriptions)) throw new Error('FRESH_OUTPUT_ROLE_DESCRIPTIONS_REQUIRED')
  const permissions = {}
  for (const role of ['roles/owner', ...OUTPUT_ROLES]) {
    const description = roleDescriptions[role]
    if (!plain(description) || description.name !== role || description.deleted === true || !Array.isArray(description.includedPermissions) || !description.includedPermissions.length || description.includedPermissions.some(permission => !validPermission(permission)) || new Set(description.includedPermissions).size !== description.includedPermissions.length) throw new Error('EXACT_FRESH_ROLE_PERMISSION_DESCRIPTION_REQUIRED')
    permissions[role] = new Set(description.includedPermissions)
  }
  for (const role of OUTPUT_ROLES) {
    // Fail closed for future new/wildcard Datastore permissions rather than
    // assuming a role's friendly name continues to guarantee read-only data.
    for (const permission of permissions[role]) if (sourceDataPermission(permission) && !/\.(?:get|list|getMetadata|getIamPolicy|listEffectiveTags|listTagBindings|search)$/.test(permission)) throw new Error('OUTPUT_ROLE_HAS_NON_READ_DATASTORE_PERMISSION')
  }
  for (const role of ['roles/datastore.viewer', 'roles/resourcemanager.projectIamAdmin']) for (const permission of permissions[role]) if (!permissions['roles/owner'].has(permission)) throw new Error('HUMAN_ROLE_CHANGE_MUST_NOT_EXPAND_EXISTING_OWNER_AUTHORITY')
  if (!permissions['roles/resourcemanager.projectIamAdmin'].has('resourcemanager.projects.getIamPolicy') || !permissions['roles/resourcemanager.projectIamAdmin'].has('resourcemanager.projects.setIamPolicy')) throw new Error('PROJECT_ONLY_ROLLBACK_IAM_AUTHORITY_REQUIRED')
  for (const permission of READ_PROBES) if (!permissions['roles/datastore.viewer'].has(permission)) throw new Error('DATA_EXPORT_READ_PERMISSION_MUST_REMAIN')
  return Object.fromEntries(Object.entries(roleDescriptions).filter(([name]) => ['roles/owner', ...OUTPUT_ROLES].includes(name)).map(([name, description]) => [name, sha256(canonical(description))]))
}

function generateSourceFreezePolicy(original, { projectId, roleDescriptions } = {}) {
  if (projectId !== PROJECT) throw new Error('EXACT_TALIO_SOURCE_PROJECT_REQUIRED')
  validatePolicy(original)
  if (original.bindings.length !== Object.keys(EXPECTED).length) throw new Error('UNEXPECTED_SOURCE_PROJECT_GRANT_REQUIRES_REVIEW')
  const seen = new Set()
  for (const binding of original.bindings) {
    if (!EXPECTED[binding.role] || seen.has(binding.role) || canonical(binding.members) !== canonical([EXPECTED[binding.role]])) throw new Error('UNEXPECTED_SOURCE_PROJECT_ROLE_OR_MEMBER_REQUIRES_REVIEW')
    seen.add(binding.role)
  }
  const roleDescriptionHashes = validateDescriptions(roleDescriptions)
  const proposed = clone(original)
  proposed.bindings = []
  for (const binding of original.bindings) {
    if (binding.role === 'roles/owner') proposed.bindings.push({ role: 'roles/datastore.viewer', members: [HUMAN] }, { role: 'roles/resourcemanager.projectIamAdmin', members: [HUMAN] })
    else if (['roles/datastore.user', 'roles/firebaserules.system'].includes(binding.role)) proposed.bindings.push({ role: 'roles/datastore.viewer', members: [...binding.members] })
    else proposed.bindings.push(clone(binding))
  }
  // IAM requires one unconditional binding per role. Combine only the two
  // explicitly changed human/data/rules viewer bindings; unrelated bindings
  // are untouched. Broad Project Viewer is deliberately never granted.
  const viewers = proposed.bindings.filter(binding => binding.role === 'roles/datastore.viewer')
  const firstViewer = proposed.bindings.indexOf(viewers[0])
  proposed.bindings = proposed.bindings.filter(binding => binding.role !== 'roles/datastore.viewer')
  proposed.bindings.splice(firstViewer, 0, { role: 'roles/datastore.viewer', members: viewers.flatMap(binding => binding.members) })
  return { policy: proposed, originalBackup: clone(original), report: { command: 'pure-source-freeze-policy-plan', projectId, originalPolicyHash: sha256(canonical(original)), proposedPolicyHash: sha256(canonical(proposed)), roleDescriptionHashes, etagPreserved: true, versionPreserved: true, sourceDataMutations: 0, providerOperations: 0, policyApplied: false, effectiveWriteFenceVerified: false, projectIamRollbackRetained: true, authorityExpanded: false }, requirements: {
    sourceProject: PROJECT,
    principalsToProbe: [HUMAN, DATA, RULES, FIRESTORE],
    mustDenyPermissions: [...WRITE_PROBES],
    mustPreserveReadPermissionsForDataPrincipal: [...READ_PROBES],
    humanRollbackPermissions: ['resourcemanager.projects.getIamPolicy', 'resourcemanager.projects.setIamPolicy'],
    requiredOperationalChecks: ['fresh-project-policy-readback-matches-planned-bindings', 'effective-IAM-inherited-organization-folder-and-database-policies-reviewed', 'no-other-service-account-or-user-credential-grants-write-permissions', 'client-security-rules-deny-source-writes', 'testIamPermissions-as-each-actual-writer-shows-no-write-permissions', 'unsatisfiable-precondition-write-probe-denied-without-committing-source-data', 'source-traffic-and-background-writers-blocked-and-in-flight-work-drained', 'existing-direct-upload-tokens-expired-and-Blob-writers-blocked', 'maintenance-remains-active-until-final-candidate-and-deployed-acceptance'],
    negativeProbeMustNotCommitSourceData: true,
    positiveReadAndHumanRollbackProbesRequired: true,
    originalEtagCannotBeUsedForRestoration: true,
  } }
}

function generateSourcePolicyRestoration(original, current, options) {
  const plan = generateSourceFreezePolicy(original, options)
  validatePolicy(current)
  if (comparablePolicy(current) !== comparablePolicy(plan.policy)) throw new Error('SOURCE_POLICY_CHANGED_SINCE_FREEZE_MANUAL_REVIEW_REQUIRED')
  // Fresh current etag prevents overwriting concurrent IAM changes. Never apply
  // the original backup etag after a successful freeze policy update.
  return { ...clone(original), etag: current.etag }
}

module.exports = { generateSourceFreezePolicy, generateSourcePolicyRestoration, comparablePolicy, validPermission, sourceDataPermission, PROJECT, EXPECTED, WRITE_PROBES, READ_PROBES }
