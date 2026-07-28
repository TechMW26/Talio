const fs = require('fs')
const path = require('path')

describe('loading button layout', () => {
  test('inline branded loaders cannot consume flex button spacing', () => {
    const globalStyles = fs.readFileSync(path.join(process.cwd(), 'app', 'globals.css'), 'utf8')

    expect(globalStyles).toContain('button .talio-loader')
    expect(globalStyles).toContain('margin-inline: 0 !important')
  })
})
