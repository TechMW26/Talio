import fs from 'fs'
import path from 'path'

const root = process.cwd()
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const nextConfig = require(path.join(root, 'next.config.js'))

describe('Vercel production build configuration', () => {
  test('keeps Sentry out of runtime and build dependencies', () => {
    expect(packageJson.dependencies?.['@sentry/nextjs']).toBeUndefined()
    expect(packageJson.devDependencies?.['@sentry/nextjs']).toBeUndefined()

    const runtimeFiles = [
      'next.config.js',
      'instrumentation.js',
      'app/global-error.jsx',
      'lib/security/securityHeaders.js',
      'server.js',
      'Dockerfile',
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
    expect(instrumentation).toContain("process.env.VERCEL === '1'")
  })
})
