import { MIRA_SCREEN_INSTRUCTIONS, readMiraDesktopScreen } from '@/lib/miraDesktopScreen'

afterEach(() => { delete window.electronAPI; jest.restoreAllMocks() })

test('screen tool requires native desktop support and sends one image attachment', async () => {
  const bytes = btoa('jpeg')
  window.electronAPI = { captureMiraDesktopScreen: jest.fn(async () => ({ success: true, image: bytes, capturedAt: 1 })) }
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, attachment: { id: 'screen-1', excerpt: 'visible task' } }) }))
  await expect(readMiraDesktopScreen({ token: 'token' })).resolves.toMatchObject({ id: 'screen-1', name: expect.stringContaining('Screen captured') })
  expect(global.fetch).toHaveBeenCalledWith('/api/ai/mira-attachments', expect.objectContaining({ method: 'POST' }))
})

test('screen instructions prohibit repeated capture and ordinary-question capture', () => {
  expect(MIRA_SCREEN_INSTRUCTIONS).toContain('screenContextAttempted is true')
  expect(MIRA_SCREEN_INSTRUCTIONS).toContain('ordinary general questions')
})
