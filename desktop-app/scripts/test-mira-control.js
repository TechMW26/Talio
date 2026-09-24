// Harmless real mouse/keyboard test against our own temporary Cocoa window.
const { execFileSync, spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const root = path.resolve(__dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'talio-control-test-'))
const fixture = path.join(temp, 'mira-fixture')
execFileSync('xcrun', ['swiftc', path.join(__dirname, 'mira-control-fixture.swift'), '-o', fixture])
const child = spawn(fixture, [], { stdio: ['ignore', 'pipe', 'inherit'] })
const helper = path.join(root, `build/mira-control-${process.arch}`)
let output = '', started = false
const timeout = setTimeout(() => { child.kill(); process.exitCode = 1; console.error('Native test timed out') }, 20000)
const run = action => {
  const result = JSON.parse(execFileSync(helper, [JSON.stringify(action)], { encoding: 'utf8' }))
  if (!result.success) throw new Error(result.message)
}
child.stdout.on('data', async chunk => {
  output += chunk.toString()
  if (!started && output.includes('\n')) {
    started = true
    const points = JSON.parse(output.split('\n')[0])
    try {
      await new Promise(resolve => setTimeout(resolve, 500))
      const state = JSON.parse(execFileSync(helper, [JSON.stringify({ type: 'status' })], { encoding: 'utf8' }))
      if (state.pid !== child.pid) throw new Error('Test window lost focus; refusing to inject input.')
      run({ type: 'click', ...points.field })
      await new Promise(resolve => setTimeout(resolve, 150))
      run({ type: 'type', text: 'MIRA native smoke test' })
      await new Promise(resolve => setTimeout(resolve, 150))
      run({ type: 'click', ...points.button })
    } catch (error) { console.error(error.message); child.kill(); process.exitCode = 1 }
  }
})
child.on('exit', () => { clearTimeout(timeout); const passed = output.includes('\nPASS'); console.log(passed ? 'PASS: actual macOS click, Unicode typing, and verification button' : `FAIL: native fixture ${output}`); if (!passed) process.exitCode = 1 })
