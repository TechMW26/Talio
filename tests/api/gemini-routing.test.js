// Tests that lib/gemini.js correctly re-exports from the Gemini-only
// aiProviderManager. All consumer imports from @/lib/gemini should work.

const ORIGINAL_ENV = process.env

function clearGeminiKeys(env) {
    for (const k of Object.keys(env)) {
        if (/^GEMINI_(API_)?KEY/i.test(k)) {
            delete env[k]
        }
    }
    delete env.GEMINI_KEY
}

describe('lib/gemini.js shim (Gemini-only)', () => {
    beforeEach(() => {
        jest.resetModules()
        process.env = { ...ORIGINAL_ENV }
        clearGeminiKeys(process.env)
        global.fetch = jest.fn()
        jest.spyOn(console, 'warn').mockImplementation(() => { })
        jest.spyOn(console, 'log').mockImplementation(() => { })
    })

    afterEach(() => {
        process.env = ORIGINAL_ENV
        delete global.fetch
        jest.restoreAllMocks()
    })

    test('generateContent from lib/gemini calls Gemini REST API', async () => {
        process.env.GEMINI_API_KEY_1 = 'AIzagmshim-testkey-1'

        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValue({
                candidates: [{ content: { parts: [{ text: 'shim works' }] } }],
            }),
        })

        const { generateContent } = require('@/lib/gemini')
        const result = await generateContent('test prompt')

        expect(result).toBe('shim works')
        expect(global.fetch).toHaveBeenCalledTimes(1)
        expect(global.fetch.mock.calls[0][0]).toContain('generativelanguage.googleapis.com')
    })

    test('generateVisionContent from lib/gemini sends inline images to flash-lite', async () => {
        process.env.GEMINI_API_KEY_1 = 'AIzagmshim-testkey-1'
        const imgB64 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>').toString('base64')

        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValue({
                candidates: [{ content: { parts: [{ text: 'vision works' }] } }],
            }),
        })

        const { generateVisionContent } = require('@/lib/gemini')
        const result = await generateVisionContent('describe', [
            { data: imgB64, mimeType: 'image/svg+xml' },
        ])

        expect(result).toBe('vision works')
        const body = JSON.parse(global.fetch.mock.calls[0][1].body)
        expect(body.contents[0].parts[1].inlineData.data).toBe(imgB64)
    })

    test('generateStitchedVisionContent from lib/gemini accepts buffer payload', async () => {
        process.env.GEMINI_API_KEY_1 = 'AIzagmshim-testkey-1'

        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValue({
                candidates: [{ content: { parts: [{ text: 'stitched' }] } }],
            }),
        })

        const { generateStitchedVisionContent } = require('@/lib/gemini')
        const result = await generateStitchedVisionContent('analyze', {
            buffer: Buffer.from('img'),
            mimeType: 'image/webp',
        })

        expect(result).toBe('stitched')
    })

    test('getAIAvailability reports Gemini status via lib/gemini', () => {
        process.env.GEMINI_API_KEY_1 = 'AIzagmshim-testkey-1'

        const { getAIAvailability } = require('@/lib/gemini')
        const avail = getAIAvailability()

        expect(avail.anyAvailable).toBe(true)
        expect(avail.provider).toBe('gemini')
        expect(avail.geminiKeys).toBe(1)
    })

    test('throws when no Gemini keys configured via lib/gemini', async () => {
        const { generateContent } = require('@/lib/gemini')
        await expect(generateContent('hi')).rejects.toThrow('Gemini is not configured')
    })

    test('key rotation via lib/gemini shim', async () => {
        process.env.GEMINI_API_KEY_1 = 'AIzak1-testkey'
        process.env.GEMINI_API_KEY_2 = 'AIzak2-testkey'

        global.fetch
            .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'rate limited' })
            .mockResolvedValueOnce({
                ok: true,
                json: jest.fn().mockResolvedValue({
                    candidates: [{ content: { parts: [{ text: 'second key' }] } }],
                }),
            })

        const { generateContent } = require('@/lib/gemini')
        const result = await generateContent('hello')

        expect(result).toBe('second key')
        expect(global.fetch.mock.calls[0][0]).toContain('key=AIzak1-testkey')
        expect(global.fetch.mock.calls[1][0]).toContain('key=AIzak2-testkey')
    })
})
