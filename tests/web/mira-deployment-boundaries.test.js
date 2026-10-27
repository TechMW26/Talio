const fs = require('node:fs')
const path = require('node:path')

test('Vercel includes every shared desktop planner dependency without shipping native runtimes', () => {
  const rules = fs.readFileSync('.vercelignore', 'utf8').split(/\r?\n/)
  const ignore = require('ignore')().add(rules.join('\n'))
  expect(rules).toContain('desktop-app/*')
  expect(rules).toContain('desktop-app/src/*')
  const queue = ['desktop-app/src/miraActionPlan.js', 'desktop-app/src/miraOrchestration.js']
  const visited = new Set()
  while (queue.length) {
    const file = queue.shift()
    if (visited.has(file)) continue
    visited.add(file)
    expect(rules).toContain('!' + file)
    expect(ignore.ignores(file)).toBe(false)
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(/require\(['"](\.\/[^'"]+)['"]\)/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]))
      queue.push(target.endsWith('.js') ? target : target + '.js')
    }
  }
  expect(rules).not.toContain('!desktop-app/build')
})
