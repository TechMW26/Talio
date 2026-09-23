// Reproducible local conversion of the official Apache-2.0 Vosk model to browser format.
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const source = 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip'
const temp = await mkdtemp(join(tmpdir(), 'talio-wake-model-'))
const response = await fetch(source)
if (!response.ok) throw new Error(`Model download failed: ${response.status}`)
const bytes = Buffer.from(await response.arrayBuffer())
const archive = join(temp, 'model.zip')
await writeFile(archive, bytes)
execFileSync('unzip', ['-q', archive, '-d', temp])
const output = new URL('../public/models/', import.meta.url)
await mkdir(output, { recursive: true })
const target = new URL('mira-vosk-en-0.15.tar.gz', output)
execFileSync('tar', ['-czf', target.pathname, '-C', temp, 'vosk-model-small-en-us-0.15'])
const sha256 = createHash('sha256').update(await readFile(target)).digest('hex')
await writeFile(new URL('mira-vosk-en-0.15.json', output), JSON.stringify({ source, license: 'Apache-2.0', sha256 }, null, 2) + '\n')
console.log('Prepared local model:', target.pathname, sha256)
