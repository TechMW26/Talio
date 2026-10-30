import { organogramCanvasWidth, buildLayout, ORGANOGRAM_GEOMETRY, fitOrganogramWidth } from '@/lib/organogramLayout'

const director = (id, extra = {}) => ({ id, name: id, level: 9, children: [], ...extra })
const flatten = roots => roots.flatMap(node => [node, ...flatten(node.children || [])])

test.each([375, 960, 1200, 1600])('all five directors share the top row at viewport %s', viewport => {
  const nodes = Array.from({ length: 5 }, (_, index) => director('director-' + index))
  const width = organogramCanvasWidth(nodes, viewport)
  const { bandInfo } = buildLayout(nodes, width)
  expect(new Set(nodes.map(node => node._y)).size).toBe(1)
  expect(bandInfo[9]).toMatchObject({ count: 5, startY: nodes[0]._y, endY: nodes[0]._y + ORGANOGRAM_GEOMETRY.NH })
  for (const node of nodes) {
    expect(node._x - ORGANOGRAM_GEOMETRY.NW / 2).toBeGreaterThanOrEqual(ORGANOGRAM_GEOMETRY.PAD_X)
    expect(node._x + ORGANOGRAM_GEOMETRY.NW / 2).toBeLessThanOrEqual(width - ORGANOGRAM_GEOMETRY.PAD_X)
  }
})
test('directors are counted throughout the reporting tree, not only at its roots', () => {
  const viewer = director('viewer', { isViewer: true, dateOfJoining: '2026-01-01' })
  const roots = [director('first', { children: [viewer] }), director('second'), director('third'), director('fourth')]
  const nodes = flatten(roots)
  buildLayout(nodes, organogramCanvasWidth(roots, 960))
  expect(viewer._y).toBe(roots[0]._y)
  expect(roots[0].children[0]).toBe(viewer) // Layout never rewrites saved reporting relationships.
})
test('a promotion updates the row sizing even when total employee count is unchanged', () => {
  const nodes = [director('first'), director('second'), director('third'), director('fourth'), { id: 'viewer', name: 'Viewer', level: 8 }]
  const previousWidth = organogramCanvasWidth(nodes, 960)
  buildLayout(nodes, previousWidth)
  expect(nodes[4]._y).toBeGreaterThan(nodes[0]._y)
  nodes[4].level = 9
  const updatedWidth = organogramCanvasWidth(nodes, 960)
  expect(updatedWidth).toBeGreaterThan(previousWidth)
  buildLayout(nodes, updatedWidth)
  expect(nodes[4]._y).toBe(nodes[0]._y)
})
test('lower bands still wrap and keep their spacing below the director row', () => {
  const nodes = [director('director'), ...Array.from({ length: 8 }, (_, index) => ({ id: 'manager-' + index, name: 'Manager ' + index, level: 6 }))]
  const { bandInfo } = buildLayout(nodes, organogramCanvasWidth(nodes, 960))
  expect(new Set(nodes.filter(node => node.level === 6).map(node => node._y)).size).toBe(2)
  expect(bandInfo[6].startY).toBeGreaterThan(bandInfo[9].endY)
})
test('empty data and existing HR grouping keep their prior behavior', () => {
  expect(organogramCanvasWidth([], 375)).toBe(1200)
  const hr = director('hr', { isHR: true })
  const nodes = [director('director'), hr]
  const { bandInfo } = buildLayout(nodes, organogramCanvasWidth(nodes, 960))
  expect(bandInfo[9].count).toBe(1)
  expect(bandInfo.HR.count).toBe(1)
})
test.each([[375, 16], [960, 110], [1600, 110]])('fit-to-screen keeps directors clear of navigation at width %s', (viewportWidth, leftInset) => {
  const nodes = Array.from({ length: 5 }, (_, index) => director('director-' + index))
  const width = organogramCanvasWidth(nodes, viewportWidth)
  buildLayout(nodes, width)
  const { scale, tx } = fitOrganogramWidth(width, viewportWidth, leftInset, 16)
  expect(scale).toBeLessThanOrEqual(0.8)
  for (const node of nodes) {
    expect(tx + (node._x - ORGANOGRAM_GEOMETRY.NW / 2) * scale).toBeGreaterThanOrEqual(leftInset)
    expect(tx + (node._x + ORGANOGRAM_GEOMETRY.NW / 2) * scale).toBeLessThanOrEqual(viewportWidth - 16)
  }
})
