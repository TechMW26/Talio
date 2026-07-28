import { copyTextToClipboard } from '@/utils/clipboard'

describe('copyTextToClipboard', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    delete navigator.clipboard
  })

  test('uses the Clipboard API when available', async () => {
    const writeText = jest.fn().mockResolvedValue()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    await copyTextToClipboard('https://talio.test/join/example')

    expect(writeText).toHaveBeenCalledWith('https://talio.test/join/example')
  })

  test('falls back when Clipboard API access is denied', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: jest.fn().mockRejectedValue(new Error('Denied')) },
    })
    document.execCommand = jest.fn().mockReturnValue(true)

    await copyTextToClipboard('https://talio.test/join/example')

    expect(document.execCommand).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).toBeNull()
  })
})
