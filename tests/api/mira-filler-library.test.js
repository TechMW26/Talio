import { MIRA_FILLER_LIBRARY, createMiraFillerSelector, miraFillerCategory } from '@/lib/miraFillerLibrary'
test('720 unique bilingual categorized phrases stay short and never promise completion or a time estimate', () => {
  expect(MIRA_FILLER_LIBRARY).toHaveLength(720)
  expect(new Set(MIRA_FILLER_LIBRARY.map(x => x.text)).size).toBe(720)
  expect(new Set(MIRA_FILLER_LIBRARY.map(x => x.category)).size).toBe(12)
  for (const item of MIRA_FILLER_LIBRARY) {
    expect(item.text.length).toBeLessThan(130)
    expect(item.text).not.toMatch(/\d|successfully|completed|already sent/)
    expect(item.language === 'hi' ? /[\u0900-\u097f]/.test(item.text) : !/[\u0900-\u097f]/.test(item.text)).toBe(true)
  }
})
test.each([['Check my project tasks', 'workplace'], ['Play some music', 'music'], ['आज का मौसम कैसा है', 'research'], ['मेरी ड्राइंग कैमरे से देखो', 'camera'], ['Calculate the total', 'calculation'], ['Compare these options', 'comparison'], ['Summarize the report', 'summary']])('categorizes %s', (text, expected) => {
  expect(miraFillerCategory(text)).toBe(expected)
})
test('repeated requests cycle every phrase before repeating and avoid nearby core rephrases', () => {
  const select = createMiraFillerSelector(() => 0)
  const phrases = Array.from({ length: 30 }, () => select('research', 'hi'))
  expect(new Set(phrases).size).toBe(30)
  expect(new Set(phrases.slice(0, 8).map(x => x.replace(/^\[warm\]\[fast\] (अच्छा, |ठीक है, )?/, ''))).size).toBe(8)
})
