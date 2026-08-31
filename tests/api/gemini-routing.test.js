// Tests that lib/gemini.js correctly re-exports from the Pollinations-only
// aiProviderManager. All consumer imports from @/lib/gemini should work.

const ORIGINAL_ENV = process.env

function clearAIKeys(env) {
    delete env.POLLINATIONS_API_KEY
}

describe('lib/gemini.js shim (Pollinations-only)', () => {
    beforeEach(() => {
        jest.resetModules()
        process.env = { ...ORIGINAL_ENV }
        clearAIKeys(process.env)
        global.fetch = jest.fn()
        jest.spyOn(console, 'warn').mockImplementation(() => { })
        jest.spyOn(console, 'log').mockImplementation(() => { })
    })

    afterEach(() => {
        process.env = ORIGINAL_ENV
        delete global.fetch
        jest.restoreAllMocks()
    })

    test('generateContent from lib/gemini calls Pollinations', async () => {
        process.env.POLLINATIONS_API_KEY = 'sk_shim-testkey'

        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValue({
                choices: [{ message: { content: 'shim works' } }],
            }),
        })

        const { generateContent } = require('@/lib/gemini')
        const result = await generateContent('test prompt')

        expect(result).toBe('shim works')
        expect(global.fetch).toHaveBeenCalledTimes(1)
        expect(global.fetch.mock.calls[0][0]).toContain('gen.pollinations.ai/v1/chat/completions')
    })

    test('generateVisionContent from lib/gemini sends inline images', async () => {
        process.env.POLLINATIONS_API_KEY = 'sk_shim-testkey'
        const imgB64 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>').toString('base64')

        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValue({
                choices: [{ message: { content: 'vision works' } }],
            }),
        })

        const { generateVisionContent } = require('@/lib/gemini')
        const result = await generateVisionContent('describe', [
            { data: imgB64, mimeType: 'image/svg+xml' },
        ])

        expect(result).toBe('vision works')
        const body = JSON.parse(global.fetch.mock.calls[0][1].body)
        expect(body.messages[0].content[1].image_url.url).toBe(`data:image/svg+xml;base64,${imgB64}`)
    })

    test('generateStitchedVisionContent from lib/gemini accepts buffer payload', async () => {
        process.env.POLLINATIONS_API_KEY = 'sk_shim-testkey'

        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValue({
                choices: [{ message: { content: 'stitched' } }],
            }),
        })

        const { generateStitchedVisionContent } = require('@/lib/gemini')
        const result = await generateStitchedVisionContent('analyze', {
            buffer: Buffer.from('img'),
            mimeType: 'image/webp',
        })

        expect(result).toBe('stitched')
    })

    test('getAIAvailability reports Pollinations status via lib/gemini', () => {
        process.env.POLLINATIONS_API_KEY = 'sk_shim-testkey'

        const { getAIAvailability } = require('@/lib/gemini')
        const avail = getAIAvailability()

        expect(avail.anyAvailable).toBe(true)
        expect(avail.provider).toBe('pollinations')
    })

    test('throws when no Pollinations key configured via lib/gemini', async () => {
        const { generateContent } = require('@/lib/gemini')
        await expect(generateContent('hi')).rejects.toThrow('Pollinations is not configured')
    })
})
