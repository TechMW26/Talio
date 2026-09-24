import { WHITEBOARD_TEMPLATES, resolveWhiteboardTemplate, buildWhiteboardTemplatePrompt } from '@/lib/whiteboardTemplates'
import fs from 'node:fs'
import path from 'node:path'

test.each(Object.keys(WHITEBOARD_TEMPLATES))('retains the %s template contract', template => {
  expect(resolveWhiteboardTemplate(template)).toBe(template)
  expect(buildWhiteboardTemplatePrompt('My topic', template)).toContain(`"templateType":"${template}"`)
})
test('old adaptive generations map to the original mindmap renderer', () => {
  expect(resolveWhiteboardTemplate('adaptive')).toBe('mindmap')
  expect(resolveWhiteboardTemplate('__proto__')).toBe('mindmap')
})
test('generic diagram metadata cannot bypass template rendering', () => {
  const route = fs.readFileSync(path.join(process.cwd(), 'app/api/whiteboard/[id]/analyze/route.js'), 'utf8')
  expect(route).toContain('layoutGenerators[templateType]()')
  expect(route).not.toContain('plotWhiteboardPlan(')
})
