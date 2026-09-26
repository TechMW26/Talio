const fs = require('fs/promises')
const path = require('path')
const os = require('os')
const { createMiraFile } = require('../../desktop-app/src/miraFiles')
let root
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'mira-files-test-')) })
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })
test('creates the requested file but never overwrites existing content', async () => {
  const file = await createMiraFile('note.txt', 'Original', root)
  expect(await fs.readFile(file, 'utf8')).toBe('Original')
  await expect(createMiraFile('note.txt', 'Replacement', root)).rejects.toThrow()
  expect(await fs.readFile(file, 'utf8')).toBe('Original')
})
test.each(['../outside.txt', '/tmp/out.txt', 'run.sh', 'app.exe', '.secret.txt'])('rejects unsafe file %s', async name => {
  await expect(createMiraFile(name, 'data', root)).rejects.toThrow()
})
test('validates JSON, byte limits and symlink folders', async () => {
  await expect(createMiraFile('data.json', '{', root)).rejects.toThrow()
  await expect(createMiraFile('large.txt', 'a'.repeat(20001), root)).rejects.toThrow()
  const link = path.join(root, 'link')
  await fs.symlink(root, link)
  await expect(createMiraFile('data.txt', 'test', link)).rejects.toThrow()
})
