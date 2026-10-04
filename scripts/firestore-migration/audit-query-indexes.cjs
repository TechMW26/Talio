'use strict'
const RANGE = new Set(['!=', '<', '<=', '>', '>=', 'not-in'])
function queryShape(query) {
  const filters = query.filters || []
  const ranges = [...new Set(filters.filter(filter => RANGE.has(filter.operator)).map(filter => filter.field))]
  const ordering = query.orderBy?.length ? [...query.orderBy, ...ranges.filter(field => !query.orderBy.some(order => order.field === field)).sort().map(field => ({ field, direction: query.orderBy.at(-1).direction || 'asc' }))] : ranges.map(field => ({ field, direction: 'asc' }))
  const ordered = new Set(ordering.map(order => order.field))
  const equality = [...new Set(filters.filter(filter => !RANGE.has(filter.operator) && !filter.operator.startsWith('array-') && !ordered.has(filter.field)).map(filter => filter.field))].sort()
  const arrays = [...new Set(filters.filter(filter => filter.operator.startsWith('array-')).map(filter => filter.field))].sort()
  return { equality, arrays, ordering: ordering.map(({ field, direction = 'asc' }) => ({ field, direction })) }
}
function coveredByManifest(query, manifest) {
  const { equality, arrays, ordering } = queryShape(query)
  // Native collection-scope single-field indexes are automatic. A descending
  // field followed by explicit ASC document IDs is intentionally NOT automatic.
  if (arrays.length + equality.length + ordering.length <= 1 && !ordering.some(order => order.direction === 'desc' && query.kind !== 'count')) return true
  if (!arrays.length && !ordering.length) return true // equality index merging
  return manifest.indexes.some(index => {
    if (index.collectionGroup !== 'records' || index.queryScope !== 'COLLECTION') return false
    const fields = index.fields.slice(0, -1)
    if (fields.length !== equality.length + arrays.length + ordering.length) return false
    const prefix = fields.slice(0, equality.length + arrays.length)
    if (!equality.every(field => prefix.some(item => item.fieldPath === `data.${field}` && item.order))) return false
    if (!arrays.every(field => prefix.some(item => item.fieldPath === `data.${field}` && item.arrayConfig === 'CONTAINS'))) return false
    return ordering.every((order, i) => fields[prefix.length + i].fieldPath === `data.${order.field}` && fields[prefix.length + i].order === order.direction.toUpperCase().replace('ASC', 'ASCENDING').replace('DESC', 'DESCENDING')) && index.fields.at(-1).fieldPath === '__name__' && index.fields.at(-1).order === 'ASCENDING'
  })
}
function inspectQuery(query) {
  const filters = (query.filters || []).map(filter => filter.field === 'searchGrams' && filter.operator === 'array-contains' ? { ...filter, operator: 'array-contains-any', size: 2 } : filter), problems = []
  if (filters.filter(filter => filter.operator.startsWith('array-')).length > 1) problems.push('Multiple array membership filters')
  const exclusions = filters.filter(filter => ['!=', 'not-in'].includes(filter.operator))
  if (exclusions.length > 1) problems.push('Multiple exclusion filters')
  if (filters.some(filter => filter.operator === 'not-in') && filters.some(filter => ['in', 'array-contains-any'].includes(filter.operator))) problems.push('not-in mixed with disjunction')
  const disjunctions = filters.filter(filter => ['in', 'array-contains-any'].includes(filter.operator)).reduce((n, filter) => n * (filter.size || 1), 1)
  if (disjunctions > 30) problems.push(`Disjunction limit exceeded: ${disjunctions}`)
  const components = disjunctions * (filters.length + queryShape(query).ordering.length + 2)
  if (components > 100) problems.push(`Query component limit exceeded: ${components}`)
  return problems
}
module.exports = { queryShape, coveredByManifest, inspectQuery }
if (require.main === module) {
  const fs = require('node:fs'), path = require('node:path')
  if (!process.argv[2]) throw new Error('Provide a sanitized query corpus JSONL path')
  const manifest = require(path.resolve(__dirname, '../../firestore.indexes.json'))
  const queries = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  const unique = [...new Map(queries.map(query => [JSON.stringify({ ...query, test: undefined }), query])).values()]
  const invalid = unique.flatMap(query => { const problems = inspectQuery(query); return problems.length ? [{ query, problems }] : [] })
  const missing = unique.filter(query => !coveredByManifest(query, manifest))
  console.log(JSON.stringify({ observed: queries.length, unique: unique.length, invalid, missing }, null, 2))
  process.exitCode = invalid.length || missing.length ? 1 : 0
}
