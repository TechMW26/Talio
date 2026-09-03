/** @jest-environment node */

const fs = require('fs')
const path = require('path')

describe('dropdown appearance and selected values', () => {
  const globalStyles = fs.readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8')
  const searchableSelect = fs.readFileSync(path.join(process.cwd(), 'components/ui/heroui/SearchableSelect.js'), 'utf8')
  const attendanceSettings = fs.readFileSync(path.join(process.cwd(), 'components/settings/AttendanceMachinesSettings.js'), 'utf8')
  const assetsPage = fs.readFileSync(path.join(process.cwd(), 'app/dashboard/assets/page.js'), 'utf8')

  test('keeps populated HeroUI select values visible in both themes', () => {
    expect(globalStyles).toContain('[data-has-value="true"] button[data-slot="trigger"] [data-slot="value"]')
    expect(globalStyles).toContain('html.dark [data-slot="base"][data-has-value="true"]')
    expect(globalStyles).toContain('-webkit-text-fill-color: #f4f4f5')
  })

  test('uses one outside-labelled searchable dropdown treatment', () => {
    expect(searchableSelect).toContain("base: `talio-searchable-select")
    expect(searchableSelect).toContain('labelPlacement="outside"')
    expect(searchableSelect).toContain('selectedKey={selectedKey || null}')
    expect(searchableSelect).toContain('setInputValue(selectedLabel)')
    expect(globalStyles).toContain('.talio-searchable-select [data-slot="input-wrapper"]')
  })

  test('uses the shared control for providers and both asset assignee fields', () => {
    expect(attendanceSettings).toContain('<SearchableSelect')
    expect(attendanceSettings).not.toContain('providerListOpen')
    expect(attendanceSettings).not.toContain('providerQuery')
    expect((assetsPage.match(/<SearchableSelect/g) || [])).toHaveLength(2)
  })

  test('provides explicit company labels and string keys', () => {
    expect(attendanceSettings).toContain('key={String(company._id)}')
    expect(attendanceSettings).toContain('textValue={`${company.name} (${company.code})`}')
    expect(attendanceSettings).toContain('<SelectItem key="all" textValue="All companies">')
  })
})
