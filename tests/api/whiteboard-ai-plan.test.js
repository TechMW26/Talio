import { buildWhiteboardPlanPrompt, normalizeWhiteboardDiagram, plotWhiteboardPlan } from '@/lib/whiteboardAIPlan'
import { normalizePreparedWhiteboardContent } from '@/lib/whiteboardAIContent'
const sections = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, title: `Stage ${i}`, items: ['A relevant next step'], summary: '' }))
test('plan requests topic-specific content without quotas or fabricated research', () => {
  const prompt = buildWhiteboardPlanPrompt('Two-step onboarding', 'adaptive', 'Existing draft')
  expect(prompt).toContain('Never pad to a quota')
  expect(prompt).toContain('Do not invent research')
  expect(prompt).toContain('Existing draft')
})
test('removes invalid, duplicate and self-referencing relationships', () => {
  expect(normalizeWhiteboardDiagram({ edges: [{ from: 's0', to: 's1' }, { from: 's0', to: 's1' }, { from: 's0', to: 'missing' }, { from: 's0', to: 's0' }] }, sections).edges).toEqual([{ from: 's0', to: 's1', label: '' }])
})
test.each(['grid', 'radial', 'layered'])('%s layout gives finite, non-overlapping editable cards', layout => {
  let id = 0
  const content = normalizePreparedWhiteboardContent({ title: 'Plan', sections, diagram: { layout, edges: [{ from: 's0', to: 's1', label: 'Yes' }, { from: 's1', to: 's0', label: 'Retry' }] } })
  const result = plotWhiteboardPlan(content, 500, 300, () => `mira-${id++}`)
  const cards = result.objects.filter(object => object.type === 'rect')
  expect(cards).toHaveLength(6)
  for (const [i, a] of cards.entries()) {
    expect(Number.isFinite(a.x + a.y)).toBe(true)
    for (const b of cards.slice(i + 1)) expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true)
  }
  expect(result.objects.filter(object => object.type === 'arrow')).toHaveLength(2)
})
test('caps model output and rejects duplicate section IDs', () => {
  expect(normalizePreparedWhiteboardContent({ sections: Array.from({ length: 30 }, (_, i) => ({ id: `${i}`, items: Array(30).fill('item') })), diagram: {} }).sections).toHaveLength(16)
  expect(() => normalizePreparedWhiteboardContent({ sections: [sections[0], sections[0]], diagram: {} })).toThrow('Duplicate')
})
