// Mechanical vendor-asset sync. Run after updating either pinned voice dependency;
// commit the assets so voice works without a runtime CDN or a build-time download.
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const sources = [
  ['@elevenlabs/client', '1.27.0', 'elevenlabs-1.27.0', ['worklets/rawAudioProcessor.js', 'worklets/audioConcatProcessor.js', 'LICENSE']],
  ['@alexanderolsen/libsamplerate-js', '2.1.2', 'libsamplerate-2.1.2', ['dist/libsamplerate.worklet.js', 'LICENSE.md']],
]
for (const [name, version, folder, files] of sources) {
  const source = path.join(root, 'node_modules', name)
  const actual = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8')).version
  if (actual !== version) throw new Error(`${name} changed to ${actual}; update voice worklet paths before syncing`)
  const target = path.join(root, 'public/mira/worklets', folder)
  fs.mkdirSync(target, { recursive: true })
  for (const file of files) {
    // Normalize only line-end whitespace; retain all upstream code and notices.
    const content = fs.readFileSync(path.join(source, file), 'utf8').replace(/[\t ]+$/gm, '')
    fs.writeFileSync(path.join(target, path.basename(file)), content)
  }
}
