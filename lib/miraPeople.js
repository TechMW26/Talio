import { isDirectReport } from '@/lib/teamScope'
import { getProductivityViewStore, getProductivityVisibility, populateProductivityEmployees } from '@/lib/platform/firestoreProductivityView.server'
import { listScreenshotMaintenanceRecords } from '@/lib/platform/firestoreScreenshots.server'
import { canViewTenantScreenshots } from '@/lib/productivityPermissions'
import Fuse from 'fuse.js'

const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Converts Devanagari input for scoped directory lookup; fuzzy identity checks
// below only auto-resolve a single one-edit match and still enforce role scope.
export function romanizeMiraName(value) {
  const consonants = { क:'k',ख:'kh',ग:'g',घ:'gh',ङ:'n',च:'ch',छ:'ch',ज:'j',झ:'jh',ञ:'n',ट:'t',ठ:'th',ड:'d',ढ:'dh',ण:'n',त:'t',थ:'th',द:'d',ध:'dh',न:'n',प:'p',फ:'f',ब:'b',भ:'bh',म:'m',य:'y',र:'r',ल:'l',व:'v',श:'sh',ष:'sh',स:'s',ह:'h',ळ:'l' }
  const vowels = { 'अ':'a','आ':'aa','इ':'i','ई':'ee','उ':'u','ऊ':'oo','ए':'e','ऐ':'ai','ओ':'o','औ':'au','ा':'aa','ि':'i','ी':'ee','ु':'u','ू':'oo','े':'e','ै':'ai','ो':'o','ौ':'au','ृ':'ri','ं':'n','ँ':'n','्':'','़':'','ः':'h' }
  return [...value].map(c => consonants[c] || vowels[c] || (Object.hasOwn(vowels, c) ? '' : c)).join('')
}

function editDistance(left, right) {
  const a = String(left || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  const b = String(right || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  if (!a || !b || Math.abs(a.length - b.length) > 1) return 2
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row]
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      )
    }
    previous = current
  }
  return previous[b.length]
}

export async function resolveMiraPerson(name, user, context, { field, type } = {}) {
  name = String(name || '').trim()
  // Treat explicit letter-by-letter spelling as a name, not separate tokens.
  if (/^(?:[a-z][\s.-]+){2,}[a-z]$/i.test(name)) name = name.replace(/[\s.-]+/g, '')
  // Models sometimes preserve the employee prefix but use the visible code.
  // Resolve that code exactly, within the same authorization scope as names.
  const reference = name.match(/^employee:(.+)$/i)
  if (reference && !/^[a-f0-9]{24}$/i.test(reference[1])) name = reference[1].trim()
  const databaseName = context?.databaseName;
  if (!databaseName) throw new Error('A verified tenant is required for person lookup.');
  const store = await getProductivityViewStore(databaseName);
  const own = String(user.employeeId?._id || user.employeeId || '');
  if (/^(me|myself|self|मैं|मुझे|खुद)$/i.test(name)) {
    if (!own || !await store.get('employees', own)) throw new Error('An employee profile is required.');
    return own;
  }
  const broad = ['admin', 'hr'].includes(user.role) || ['send_message', 'create_meeting', 'lookup_people', 'invite_project', 'invite_meeting'].includes(type);
  const selected = name.match(/^employee:([a-f0-9]{24})$/i);
  let directory;
  if (selected) {
    const person = await store.get('employees', selected[1]);
    let permitted = broad || String(person?._id) === own || isDirectReport(person, own);
    if (!permitted && type === 'view_productivity' && person?.userId) permitted = await canViewTenantScreenshots(user._id || user.userId, person.userId, user.role, databaseName);
    directory = person?.status === 'active' && permitted ? [person] : [];
  } else if (broad) {
    // Explicit, bounded active contact directory for phonetic/fuzzy matching.
    // Never silently truncate: large directories require an employee identifier.
    directory = await listScreenshotMaintenanceRecords(store, 'employees', [{ field: 'status', operator: '==', value: 'active' }], 1000);
  } else if (type === 'view_productivity') {
    directory = (await getProductivityVisibility(store, user, { activeOnly: true, includeSelf: true })).employees;
  } else {
    directory = [];
    const self = own ? await store.get('employees', own) : null;
    if (self?.status === 'active') directory.push(self);
    for (const field of ['assignedManager', 'assignedTeamLead', 'reportsTo', 'reportingManager']) directory.push(...await listScreenshotMaintenanceRecords(store, 'employees', [{ field: 'status', operator: '==', value: 'active' }, { field, operator: '==', value: own }], 1000));
    directory = [...new Map(directory.map(person => [person._id, person])).values()];
  }
  directory = await populateProductivityEmployees(store, directory);
  const roman = romanizeMiraName(name.trim()).toLowerCase()
  const tokens = roman.split(/\s+/).filter(Boolean).slice(0, 6)
  const phonetic = tokens.map(token => token.replace(/[^a-z]/g, '').replace(/[aeiou]/g, '')).filter(Boolean)
  let matches = directory.filter(person => selected || String(person.employeeCode || '').toLowerCase() === name.toLowerCase()
    || (!reference && tokens.length && tokens.every(token => [person.firstName, person.lastName].some(value => String(value || '').toLowerCase().startsWith(token))))
    || (!reference && /[\u0900-\u097f]/.test(name) && phonetic.length && phonetic.every(token => [person.firstName, person.lastName].some(value => new RegExp('^[aeiou]*' + [...token].map(escape).join('[aeiou]*') + '[aeiou]*$', 'i').test(value || ''))))).slice(0, 11);
  let uniqueCloseTypo = false
  if (!matches.length && !reference && roman.length >= 3) {
    // Retry from the permitted directory, not just a prefix query: ASR typos in
    // any character (for example Pinki -> Pinky) must not hide a unique person.
    const candidates = directory
    const close = roman.length >= 4
      ? candidates.filter(person => editDistance(roman, person.firstName) === 1 || editDistance(roman, `${person.firstName || ''} ${person.lastName || ''}`) === 1)
      : []
    const uniqueIds = new Set(close.map(person => String(person._id)))
    if (uniqueIds.size === 1) {
      matches = [close[0]]
      uniqueCloseTypo = true
    } else {
      const fuzzy = new Fuse(candidates.map(person => ({ ...person, fullName: `${person.firstName || ''} ${person.lastName || ''}` })), { keys: ['firstName', 'lastName', 'fullName', 'employeeCode'], threshold: 0.35, ignoreLocation: true })
        .search(roman).slice(0, 11).map(match => match.item)
      matches = [...new Map([...close, ...fuzzy].map(person => [String(person._id), person])).values()].slice(0, 11)
    }
  }
  const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
  if (type !== 'lookup_people' && matches.length === 1 && (selected || uniqueCloseTypo || [matches[0].employeeCode, matches[0].firstName, `${matches[0].firstName} ${matches[0].lastName || ''}`].some(value => normalize(value) === normalize(name)))) return String(matches[0]._id)
  const error = new Error(matches.length ? `Choose the person you mean by “${name}”. If none is right, could you spell the name or give their full name?` : `No matching person found for “${name}” within your available contacts. Could you spell the name letter by letter, or give their full name or employee code?`)
  error.resolution = { field, query: name, more: matches.length > 10, candidates: matches.slice(0, 10).map(person => ({ value: `employee:${person._id}`, name: `${person.firstName || ''} ${person.lastName || ''}`.trim(), code: person.employeeCode || '', department: person.department?.name || '' })) }
  throw error
}
