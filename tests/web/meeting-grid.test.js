import { getMeetingGrid } from '@/lib/meetingGrid'

test.each([1, 2, 3, 4, 6, 9, 16])('fits %i equal widescreen tiles in a desktop stage', count => {
  const { columns, tileWidth } = getMeetingGrid(1400, 800, count)
  expect(tileWidth).toBeGreaterThan(0)
  expect(columns * tileWidth + (columns - 1) * 12).toBeLessThanOrEqual(1400.001)
  const rows = Math.ceil(count / columns)
  expect(rows * tileWidth * 9 / 16 + (rows - 1) * 12).toBeLessThanOrEqual(800.001)
})

test('narrow and crowded stages remain usable and may scroll', () => {
  expect(getMeetingGrid(320, 500, 30)).toEqual({ columns: 1, tileWidth: 320 })
  expect(getMeetingGrid(0, 0, 0).tileWidth).toBe(0)
  expect(getMeetingGrid(1400, 800, 6).columns).toBeGreaterThan(getMeetingGrid(320, 500, 6).columns)
})
