import { buildDirectReportsFilter } from '@/lib/teamScope'
import Fuse from 'fuse.js'

const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Used only to suggest candidates, never to choose a recipient automatically.
export function romanizeMiraName(value) {
  const consonants = { क:'k',ख:'kh',ग:'g',घ:'gh',ङ:'n',च:'ch',छ:'ch',ज:'j',झ:'jh',ञ:'n',ट:'t',ठ:'th',ड:'d',ढ:'dh',ण:'n',त:'t',थ:'th',द:'d',ध:'dh',न:'n',प:'p',फ:'f',ब:'b',भ:'bh',म:'m',य:'y',र:'r',ल:'l',व:'v',श:'sh',ष:'sh',स:'s',ह:'h',ळ:'l' }
  const vowels = { 'अ':'a','आ':'aa','इ':'i','ई':'ee','उ':'u','ऊ':'oo','ए':'e','ऐ':'ai','ओ':'o','औ':'au','ा':'aa','ि':'i','ी':'ee','ु':'u','ू':'oo','े':'e','ै':'ai','ो':'o','ौ':'au','ृ':'ri','ं':'n','ँ':'n','्':'','़':'','ः':'h' }
  return [...value].map(c => consonants[c] || vowels[c] || (Object.hasOwn(vowels, c) ? '' : c)).join('')
}

export async function resolveMiraPerson(name, user, models, { field, type } = {}) {
  const own = String(user.employeeId?._id || user.employeeId || '')
  if (/^(me|myself|self|मैं|मुझे|खुद)$/i.test(name)) return own
  const broad = ['admin', 'hr'].includes(user.role) || ['send_message', 'create_meeting', 'lookup_people', 'invite_project', 'invite_meeting'].includes(type)
  let scope = broad ? {} : { $or: [{ _id: own }, buildDirectReportsFilter(own)] }
  if (type === 'view_productivity' && !broad) {
    const departments = await models.Department.find({ $or: [{ head: own }, { heads: own }] }).select('_id').lean()
    const ids = departments.map(d => d._id)
    scope = { $or: [{ _id: own }, buildDirectReportsFilter(own), { department: { $in: ids } }, { departments: { $in: ids } }] }
  }
  const selected = name.match(/^employee:([a-f0-9]{24})$/i)
  const roman = romanizeMiraName(name.trim()).toLowerCase()
  const tokens = roman.split(/\s+/).filter(Boolean).slice(0, 6)
  const phonetic = tokens.map(token => token.replace(/[^a-z]/g, '').replace(/[aeiou]/g, '')).filter(Boolean)
  const clauses = [{ employeeCode: new RegExp(`^${escape(name)}$`, 'i') }]
  if (tokens.length) clauses.push({ $and: tokens.map(token => ({ $or: ['firstName', 'lastName'].map(key => ({ [key]: new RegExp(`^${escape(token)}`, 'i') })) })) })
  if (phonetic.length && /[\u0900-\u097f]/.test(name)) clauses.push({ $and: phonetic.map(token => ({ $or: ['firstName', 'lastName'].map(key => ({ [key]: new RegExp(`^[aeiou]*${[...token].map(escape).join('[aeiou]*')}[aeiou]*$`, 'i') })) })) })
  let matches = await models.Employee.find({ $and: [scope, { status: 'active' }, selected ? { _id: selected[1] } : { $or: clauses }] })
    .select('_id firstName lastName employeeCode department').populate('department', 'name').limit(11).lean()
  if (!matches.length && !selected && roman.length >= 3) {
    const candidates = await models.Employee.find({ $and: [scope, { status: 'active' }, { $or: ['firstName', 'lastName'].map(key => ({ [key]: new RegExp(`^${escape(roman[0])}`, 'i') })) }] })
      .select('_id firstName lastName employeeCode department').populate('department', 'name').limit(200).lean()
    matches = new Fuse(candidates.map(person => ({ ...person, fullName: `${person.firstName || ''} ${person.lastName || ''}` })), { keys: ['firstName', 'lastName', 'fullName', 'employeeCode'], threshold: 0.35, ignoreLocation: true })
      .search(roman).slice(0, 11).map(match => match.item)
  }
  const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
  if (type !== 'lookup_people' && matches.length === 1 && (selected || [matches[0].employeeCode, matches[0].firstName, `${matches[0].firstName} ${matches[0].lastName || ''}`].some(value => normalize(value) === normalize(name)))) return String(matches[0]._id)
  const error = new Error(matches.length ? `Choose the person you mean by “${name}”. If none is right, could you spell the name or give their full name?` : `No matching person found for “${name}” within your available contacts. Could you spell the name letter by letter, or give their full name or employee code?`)
  error.resolution = { field, query: name, more: matches.length > 10, candidates: matches.slice(0, 10).map(person => ({ value: `employee:${person._id}`, name: `${person.firstName || ''} ${person.lastName || ''}`.trim(), code: person.employeeCode || '', department: person.department?.name || '' })) }
  throw error
}
