import fs from 'fs'
import path from 'path'

const source = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('Dark startup and navigation surfaces', () => {
  test('does not mount a route progress bar', () => {
    expect(source('app/dashboard/layout.js')).not.toContain('RouteProgressBar')
  })

  test('session and splash screens never force a white canvas', () => {
    for (const file of ['app/page.js', 'components/SplashVideo.js']) {
      expect(source(file)).toContain("backgroundColor: '#09090b'")
      expect(source(file)).not.toMatch(/background(?:-color|Color):\s*['"]?#(?:fff(?:fff)?|fbfcfc)\b/i)
    }
    expect(source('app/layout.js')).toContain("themeColor: '#09090b'")
    expect(source('components/SplashVideo.js')).not.toContain('#fbfcfc')
    expect(source('app/global-error.jsx')).toContain("colorScheme: 'dark'")
  })

  test.each([
    'desktop-app/src/loader.html',
    'desktop-app/src/welcome.html',
    'desktop-app/src/offline.html',
    'desktop-app/src/update.html',
    'public/offline.html',
    'public/error-fallback.html',
    'public/clear-cache.html',
  ])('%s has a dark canvas without requiring app styles', (file) => {
    expect(source(file)).toContain('#09090b')
    expect(source(file)).toMatch(/color-scheme:\s*dark/)
  })

  test('keeps updater download progress and existing onboarding controls', () => {
    expect(source('desktop-app/src/loader.html')).not.toContain('class="status-line"')
    expect(source('desktop-app/src/update.html')).toContain('id="progressBar"')
    expect(source('desktop-app/src/welcome.html')).toContain('-webkit-app-region: drag')
  })
})
