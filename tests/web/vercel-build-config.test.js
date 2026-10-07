import fs from 'fs'
import path from 'path'

const root = process.cwd()
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const nextConfig = require(path.join(root, 'next.config.js'))
const vercelConfig = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'))

describe('Vercel production build configuration', () => {
  test('includes the shared MIRA action policy without desktop build artifacts', () => {
    const ignore = require('ignore')().add(fs.readFileSync(path.join(root, '.vercelignore'), 'utf8'))
    expect(ignore.ignores('desktop-app/src/miraActionPlan.js')).toBe(false)
    expect(ignore.ignores('desktop-app/src/main.js')).toBe(true)
    expect(ignore.ignores('desktop-app/node_modules/example/index.js')).toBe(true)
    expect(ignore.ignores('desktop-app/dist/Talio.dmg')).toBe(true)
  })

  test('keeps Sentry out of runtime and build dependencies', () => {
    expect(packageJson.dependencies?.['@sentry/nextjs']).toBeUndefined()
    expect(packageJson.devDependencies?.['@sentry/nextjs']).toBeUndefined()

    const runtimeFiles = [
      'next.config.js',
      'instrumentation.js',
      'app/global-error.jsx',
      'lib/security/securityHeaders.js',
    ]

    runtimeFiles.forEach((file) => {
      const source = fs.readFileSync(path.join(root, file), 'utf8')
      expect(source.toLowerCase()).not.toContain('sentry')
    })
  })

  test('removes Sentry-only sample and instrumentation files', () => {
    [
      'instrumentation-client.js',
      'sentry.server.config.js',
      'sentry.edge.config.js',
      'lib/sentryMetrics.js',
      'app/api/sentry-example-api/route.js',
      'app/api/sentry/metrics-test/route.js',
      'app/sentry-example-page/page.jsx',
    ].forEach((file) => {
      expect(fs.existsSync(path.join(root, file))).toBe(false)
    })
  })

  test('bounds Vercel memory and avoids production source-map work', () => {
    expect(packageJson.scripts['vercel-build']).toContain('--max-old-space-size=6144')
    expect(packageJson.scripts['vercel-build']).toContain('NEXT_BUILD_CPUS=4')
    expect(nextConfig.productionBrowserSourceMaps).toBe(false)
    expect(nextConfig.experimental.webpackBuildWorker).toBe(true)
    expect(nextConfig.experimental.serverSourceMaps).toBe(false)
  })

  test('preserves Vercel realtime initialization', () => {
    const instrumentation = fs.readFileSync(path.join(root, 'instrumentation.js'), 'utf8')
    expect(instrumentation).toContain('initializeServerlessRealtime')
    expect(instrumentation).toContain('process.env.NEXT_RUNTIME === "nodejs"')
  })

  test('uses Fluid compute in the data-local deployment region', () => {
    expect(vercelConfig.fluid).toBe(true)
    expect(vercelConfig.regions).toEqual(['bom1'])
  })

  test('uses a tested native build and main-only automatic deployments', () => {
    expect(vercelConfig.framework).toBe('nextjs')
    expect(vercelConfig.services).toBeUndefined()
    expect(vercelConfig.buildCommand).toBe('npm run release:check && npm run vercel-build')
    expect(packageJson.scripts['release:check']).toContain('cross-env NODE_ENV=test jest')
    expect(vercelConfig.git.deploymentEnabled).toEqual({ '**': false, main: true })
    expect(nextConfig.output).toBeUndefined()
    for (const file of ['Dockerfile', '.dockerignore', 'vercel.container.json', 'docs/CONTAINER_DEPLOYMENT.md']) {
      expect(fs.existsSync(path.join(root, file))).toBe(false)
    }
    expect(fs.readFileSync(path.join(root, 'next.config.js'), 'utf8')).not.toContain('TALIO_CONTAINER_BUILD')
  })

  test('documents encrypted, fail-fast Redis settings', () => {
    const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8')
    expect(envExample).toContain('REDIS_URL=rediss://')
    expect(envExample).toContain('REDIS_OPERATION_TIMEOUT_MS=200')
    expect(envExample).toContain('REDIS_CONNECT_TIMEOUT_MS=3000')
  })
})
