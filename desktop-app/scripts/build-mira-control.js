const { execFileSync } = require('child_process')
const path = require('path')
module.exports = async function(context) {
  const fs = require('fs')
  const targetArch = context.arch === 1 ? 'x64' : 'arm64'
  const runtime = path.resolve(__dirname, '..', 'build', `agent-s-${context.electronPlatformName}-${targetArch}`, 'runtime.json')
  if (!fs.existsSync(runtime)) throw new Error(`Missing local Agent S runtime for ${context.electronPlatformName}-${targetArch}. Build it on that OS/architecture first with npm run build:agent-s.`)
  const manifest = JSON.parse(fs.readFileSync(runtime, 'utf8'))
  const sourceHash = require('crypto').createHash('sha256')
  for (const file of ['actions.py', 'control.py', 'worker.py']) sourceHash.update(fs.readFileSync(path.resolve(__dirname, '..', 'agent-s', file)))
  if (manifest.sourceHash !== sourceHash.digest('hex')) throw new Error('Stale Agent S runtime. Rebuild it from the current control sources before packaging.')
  if (manifest.platform !== context.electronPlatformName || manifest.arch !== targetArch || manifest.revision !== '3aa272d23d2994c7bbde1acbbe0ef8e8d06b8693') throw new Error('Agent S runtime target mismatch')
  if (context.electronPlatformName !== 'darwin') return
  const root = path.resolve(__dirname, '..')
  const arch = context.arch === 1 ? 'x86_64' : 'arm64'
  execFileSync('xcrun', ['swiftc', '-O', '-target', `${arch}-apple-macos14.0`, path.join(root, 'src/miraControl.swift'), '-o', path.join(root, `build/mira-control-${context.arch === 1 ? 'x64' : 'arm64'}`)], { stdio: 'inherit' })
}
