import fs from 'fs'
import path from 'path'

describe('temporal input label layout', () => {
  const globalStyles = fs.readFileSync(path.join(process.cwd(), 'app', 'globals.css'), 'utf8')
  const interviewPage = fs.readFileSync(
    path.join(process.cwd(), 'app', 'dashboard', 'recruitment', 'interviews', 'page.js'),
    'utf8'
  )

  test('floats labels for every HeroUI datetime-local input', () => {
    expect(globalStyles).toContain(
      '[data-slot="input-wrapper"]:has([data-slot="inner-wrapper"] input[type="datetime-local"]) > [data-slot="label"]'
    )
    expect(globalStyles).toMatch(/translateY\(-0\.6875rem\) scale\(0\.85\) !important/)
  })

  test('keeps the reported interview field label outside the native control', () => {
    expect(interviewPage).toMatch(
      /<Input label="Date & Time" labelPlacement="outside-top" type="datetime-local"/
    )
  })
})
