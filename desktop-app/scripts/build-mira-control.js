const { execFileSync } = require('child_process')
const path = require('path')
module.exports = async function(context) {
  if (context.electronPlatformName !== 'darwin') return
  const root = path.resolve(__dirname, '..')
  const arch = context.arch === 1 ? 'x86_64' : 'arm64'
  execFileSync('xcrun', ['swiftc', '-O', '-target', `${arch}-apple-macos14.0`, path.join(root, 'src/miraControl.swift'), '-o', path.join(root, `build/mira-control-${context.arch === 1 ? 'x64' : 'arm64'}`)], { stdio: 'inherit' })
}
