// Independent compiler output for each local server. Never share .next files
// between simultaneous dev processes or with a production build.
const net = require('node:net')
const { spawn } = require('node:child_process')
const args = process.argv.slice(2)
async function available(port) {
  return new Promise(resolve => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })
}
async function main() {
  const index = args.findIndex(arg => arg === '--port' || arg === '-p')
  const inline = args.find(arg => arg.startsWith('--port='))
  let port = Number(index >= 0 ? args[index + 1] : inline?.split('=')[1] || process.env.PORT || 3000)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid development port')
  if (index < 0 && !inline && !process.env.PORT) {
    while (!(await available(port))) {
      if (++port > 3020) throw new Error('No free development port between 3000 and 3020')
    }
  }
  const dist = `.next-dev-${port}`
  console.log(`Talio development: http://localhost:${port} (isolated cache: ${dist})`)
  const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', ...args, ...(index < 0 && !inline ? ['--port', String(port)] : [])], {
    stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development', TZ: 'Asia/Kolkata', NEXT_DIST_DIR: dist },
  })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
  child.on('exit', code => { process.exitCode = code || 0 })
  child.on('error', error => { console.error(error.message); process.exitCode = 1 })
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
