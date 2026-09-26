import { resolveMiraPerson, romanizeMiraName } from '@/lib/miraPeople'
import { prepareMiraAction } from '@/lib/miraActions'
const user = { employeeId: 'aaaaaaaaaaaaaaaaaaaaaaaa', role: 'employee' }
const person = { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', firstName: 'Sahil', lastName: 'Sahu', employeeCode: 'U22', department: { name: 'Tech' } }
function models(rows) {
  const query = { select: jest.fn().mockReturnThis(), populate: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(rows) }
  return { Employee: { find: jest.fn(() => query) }, Chat: { findOne: jest.fn(() => ({ select: () => ({ lean: async () => null }) })) } }
}
test('unique exact names resolve and assignments retain reporting scope', async () => {
  const db = models([person])
  expect(await resolveMiraPerson('Sahil', user, db, { type: 'create_task' })).toBe(person._id)
  expect(JSON.stringify(db.Employee.find.mock.calls[0][0])).toContain('reportingManager')
})
test('Hindi phonetic matches are suggestions, never automatic recipients', async () => {
  const db = models([person])
  expect(romanizeMiraName('साहिल साहू')).toBe('saahil saahoo')
  await expect(resolveMiraPerson('साहिल', user, db, { type: 'send_message', field: 'recipient' })).rejects.toMatchObject({ resolution: { field: 'recipient', candidates: [expect.objectContaining({ name: 'Sahil Sahu', code: 'U22', department: 'Tech' })] } })
  const phonetic = db.Employee.find.mock.calls[0][0].$and[2].$or.at(-1).$and[0].$or[0].firstName
  expect(phonetic.test('Sahil')).toBe(true)
})
test('ambiguous names provide bounded real choices and no guessed identity', async () => {
  await expect(resolveMiraPerson('Sahil', user, models([person, { ...person, _id: 'cccccccccccccccccccccccc', lastName: 'Sharma' }]), { type: 'send_message' })).rejects.toMatchObject({ resolution: { candidates: expect.any(Array) } })
})
test('unmatched names ask for spelling without selecting or writing to a person', async () => {
  await expect(resolveMiraPerson('Unknown', user, models([]), { type: 'send_message' }))
    .rejects.toThrow('Could you spell the name letter by letter')
})
test('misspelled names use fuzzy candidates but require a choice', async () => {
  const db = models([person])
  db.Employee.find().lean.mockResolvedValueOnce([]).mockResolvedValueOnce([person])
  await expect(resolveMiraPerson('Sahl', user, db, { type: 'send_message' })).rejects.toMatchObject({ resolution: { candidates: [expect.objectContaining({ name: 'Sahil Sahu' })] } })
})
test('selected identifiers are looked up again within the current scope', async () => {
  const db = models([])
  await expect(resolveMiraPerson(`employee:${person._id}`, user, db, { type: 'create_task' })).rejects.toThrow('No matching person')
  expect(JSON.stringify(db.Employee.find.mock.calls[0][0])).toContain('reportingManager')
})
test('missing private conversations are prepared for authenticated create-and-send', async () => {
  const result = await prepareMiraAction({ type: 'send_message', fields: { recipient: 'Sahil', content: 'Hello' } }, user, models([person]))
  expect(result).toMatchObject({ path: '/api/chat/start-and-send', recipient: person._id, body: { content: 'Hello' } })
})
test('project invitations and meeting invites reach delegate fields', async () => {
  const project = await prepareMiraAction({ type: 'create_project', fields: { name: 'Plan', startDate: '2026-10-01', endDate: '2026-10-20', heads: ['me'], members: ['Sahil'] } }, { ...user, role: 'admin' }, models([person]))
  expect(project.body.members).toEqual([{ userId: person._id, role: 'member' }])
  const meeting = await prepareMiraAction({ type: 'create_meeting', fields: { title: 'Plan', agenda: 'Review', type: 'online', scheduledStart: '2026-10-01T10:00:00+05:30', scheduledEnd: '2026-10-01T11:00:00+05:30', invitees: ['Sahil'] } }, user, models([person]))
  expect(meeting.body.inviteeIds).toEqual([person._id])
})

test('a named project is preserved on task creation and queried within access scope', async () => {
  const db = models([])
  db.ProjectMember = { find: jest.fn(() => ({ select: () => ({ lean: async () => [] }) })) }
  db.Project = { find: jest.fn(() => ({ select: () => ({ limit: () => ({ lean: async () => [{ _id: 'cccccccccccccccccccccccc' }] }) }) })) }
  const prepared = await prepareMiraAction({ type: 'create_task', fields: { title: 'Review', assignees: ['me'], project: 'Launch' } }, user, db)
  expect(prepared.body.projectId).toBe('cccccccccccccccccccccccc')
  expect(JSON.stringify(db.Project.find.mock.calls[0][0])).toContain('projectHeads')
})

test('unknown project does not silently create a standalone task', async () => {
  const db = models([])
  db.ProjectMember = { find: () => ({ select: () => ({ lean: async () => [] }) }) }
  db.Project = { find: () => ({ select: () => ({ limit: () => ({ lean: async () => [] }) }) }) }
  await expect(prepareMiraAction({ type: 'create_task', fields: { title: 'Review', assignees: ['me'], project: 'Missing' } }, user, db)).rejects.toThrow('No task was created')
})
