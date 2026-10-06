import { getTalioFirestore } from './firestore.server'
import { assertFirestoreDataset, createFirestoreDatabase } from './firestoreStore.server'
import { applicationRecordKey, encodeApplicationRecord, decodeApplicationRecord, partIds } from './firestoreCodec.cjs'

// Explicit application configuration: no legacy provider fallback and no shared
// notification credentials. Production requires an explicitly verified cutover.
let catalogCache = null

function assertProductionCatalog(catalog) {
  if (process.env.NODE_ENV !== 'production') return
  if (catalog.purpose === 'local-acceptance-only') throw new Error('Local acceptance data must not be used in production')
  if (catalog.status !== 'ready' || catalog.purpose !== 'production' || catalog.applicationCutover !== true) {
    throw new Error('Firestore production dataset has not passed live cutover verification')
  }
}

async function getApplicationCatalog({ freshAuthorization = false } = {}) {
  const dataset = assertFirestoreDataset(process.env.FIRESTORE_DATASET)
  const firestore = getTalioFirestore()
  if (freshAuthorization || !catalogCache || catalogCache.firestore !== firestore || catalogCache.dataset !== dataset || catalogCache.expiresAt <= Date.now()) {
    const snapshot = await firestore.collection('talioDatasets').doc(dataset).get()
    const catalog = snapshot.exists ? snapshot.data() : null
    if (!catalog || !['verified-local-dataset', 'ready'].includes(catalog.status)) throw new Error('Firestore application dataset has not passed verification')
    assertProductionCatalog(catalog)
    catalogCache = { firestore, dataset, catalog, expiresAt: Date.now() + 30000 }
  }
  assertProductionCatalog(catalogCache.catalog)
  return { firestore, dataset, catalog: catalogCache.catalog }
}

export async function getFirestoreApplicationContext(databaseName, { freshAuthorization = false } = {}) {
  if (!/^talio_company_[A-Za-z0-9_-]+$/.test(databaseName || '')) throw new Error('Registered tenant context is required')
  const { firestore, dataset, catalog } = await getApplicationCatalog({ freshAuthorization })
  if (!catalog.tenants?.some(tenant => tenant.databaseName === databaseName && tenant.active !== false)) throw new Error('Tenant is not registered in this Firestore dataset')
  return { firestore, dataset, databaseName }
}

// Server-only provisioning code needs a single native transaction spanning the
// system registry and a new tenant. Never return this context to a browser.
export async function getFirestoreProvisioningContext() {
  return getApplicationCatalog()
}

/** Register only a company already persisted by the authorized superadmin API. */
export async function registerFirestoreTenant(company) {
  const databaseName = company?.databaseName
  const tenantId = String(company?._id || company?.id || '')
  if (!/^talio_company_[A-Za-z0-9_-]+$/.test(databaseName || '') || !/^[a-f\d]{24}$/i.test(tenantId)) throw new Error('Invalid company provisioning identity')
  const { firestore, dataset } = await getApplicationCatalog()
  const system = await getFirestoreSystemDatabase()
  const saved = await system.get('tenantcompanies', tenantId)
  if (!saved || saved.databaseName !== databaseName) throw new Error('Company must exist before provisioning its data scope')
  const reference = firestore.collection('talioDatasets').doc(dataset)
  await firestore.runTransaction(async tx => {
    const snapshot = await tx.get(reference)
    const tenants = snapshot.get('tenants') || []
    const conflict = tenants.find(tenant => tenant.databaseName === databaseName || tenant.tenantId === tenantId)
    if (conflict) {
      if (conflict.tenantId !== tenantId || conflict.databaseName !== databaseName) throw new Error('Tenant provisioning identity conflict')
      return
    }
    tx.update(reference, { tenants: [...tenants, { tenantId, databaseName, active: true }] })
  })
  catalogCache = null
  return { tenantId, databaseName }
}

/** Archive without deleting any tenant data. The registry and catalog switch
 * together, so a partially completed mapping cleanup cannot reopen access. */
export async function setFirestoreTenantActive(companyId, active, { superadminId } = {}) {
  if (typeof active !== 'boolean' || !superadminId) throw new Error('Authorized company status change is required')
  const { firestore, dataset } = await getApplicationCatalog()
  const root = firestore.collection('talioDatasets').doc(dataset)
  const records = name => root.collection('databases').doc('talio_superadmin').collection('collections').doc(name).collection('records')
  const result = await firestore.runTransaction(async tx => {
    async function read(snapshot) {
      if (!snapshot.exists) return null
      const envelope = snapshot.data(), ids = partIds(envelope)
      const parts = ids.length ? await tx.getAll(...ids.map(key => snapshot.ref.collection('parts').doc(key))) : []
      return decodeApplicationRecord(envelope, new Map(parts.map(part => [part.id, part.data()])))
    }
    const admin = await read(await tx.get(records('superadmins').doc(applicationRecordKey(String(superadminId)))))
    if (!admin?.isActive || admin.permissions?.canDeleteCompanies !== true) throw Object.assign(new Error('Company status change is not permitted'), { status: 403 })
    const companySnapshot = await tx.get(records('tenantcompanies').doc(applicationRecordKey(String(companyId))))
    const company = await read(companySnapshot)
    if (!company) throw Object.assign(new Error('Company not found'), { status: 404 })
    const catalogSnapshot = await tx.get(root)
    const tenants = catalogSnapshot.get('tenants') || []
    const registered = tenants.find(tenant => tenant.tenantId === String(company._id))
    if (!registered || registered.databaseName !== company.databaseName) throw new Error('Company catalog identity mismatch')
    const next = { ...company, isActive: active, updatedAt: new Date(), ...(active ? { serviceStatus: 'active', serviceResumedAt: new Date() } : { serviceStatus: 'terminated', servicePausedAt: new Date(), servicePausedReason: 'Company archived by superadmin' }) }
    const encoded = encodeApplicationRecord(next)
    tx.set(companySnapshot.ref, encoded.envelope)
    for (const part of encoded.parts) tx.set(companySnapshot.ref.collection('parts').doc(part.id), part.value)
    for (const key of partIds(companySnapshot.data())) if (!encoded.parts.some(part => part.id === key)) tx.delete(companySnapshot.ref.collection('parts').doc(key))
    tx.update(root, { tenants: tenants.map(tenant => tenant.tenantId === String(company._id) ? { ...tenant, active } : tenant) })
    return next
  })
  catalogCache = null
  return result
}

// Server infrastructure only. Do not pass this repository to tenant API handlers.
export async function getFirestoreSystemDatabase(options = {}) {
  const { firestore, dataset } = await getApplicationCatalog()
  return createFirestoreDatabase({ firestore, dataset, databaseName: 'talio_superadmin', scope: 'system', constraints: options.constraints, queryFields: options.queryFields })
}

export async function getFirestoreTenantDatabase(databaseName, options = {}) {
  const context = await getFirestoreApplicationContext(databaseName, { freshAuthorization: options.freshAuthorization === true })
  return createFirestoreDatabase({ ...context, constraints: options.constraints, queryFields: options.queryFields })
}
