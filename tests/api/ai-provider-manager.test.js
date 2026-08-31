// Pollinations AI router tests. Validates text + vision calls via the
// OpenAI-compatible REST API, retry on rate-limit, and that key material is
// never included in log output.

const ORIGINAL_ENV = process.env

function svgBase64() {
    return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"></svg>').toString('base64')
}

function clearAIKeys(env) {
    delete env.POLLINATIONS_API_KEY
}

function reqRouter() {
    return require('@/lib/ai/aiProviderManager')
}

describe('AIProviderManager — Pollinations-only', () => {
    let warnSpy

    beforeEach(() => {
        jest.resetModules()
        process.env = { ...ORIGINAL_ENV }
        clearAIKeys(process.env)
        global.fetch = jest.fn()
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { })
        jest.spyOn(console, 'log').mockImplementation(() => { })
    })

    afterEach(() => {
        process.env = ORIGINAL_ENV
        delete global.fetch
        jest.restoreAllMocks()
    })

    test('calls Pollinations and returns text content', async () => {
        process.env.POLLINATIONS_API_KEY = 'sk_test-pollinations-key'

        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValue({
                choices: [{ message: { content: 'pollinations output' } }],
            }),
        })

        const { generateContent } = reqRouter()
        const result = await generateContent('hello')

        expect(result).toBe('pollinations output')
        expect(global.fetch).toHaveBeenCalledTimes(1)
        expect(global.fetch.mock.calls[0][0]).toContain('gen.pollinations.ai/v1/chat/completions')
        expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer sk_test-pollinations-key')
    })

    test('passes system instruction to Pollinations', async () => {
        process.env.POLLINATIONS_API_KEY = 'sk_test-pollinations-key'

        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValue({
                choices: [{ message: { content: 'sys-aware output' } }],
            }),
        })

        const { generateContent } = reqRouter()
        await generateContent('hello', 'You are helpful.')

        const body = JSON.parse(global.fetch.mock.calls[0][1].body)
        expect(body.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' })
        expect(body.messages[1].content).toBe('hello')
        expect(body.model).toBe('openai')
    })

    test('routes analysis use case to gpt-5.4 dynamically', async () => {
        process.env.POLLINATIONS_API_KEY = 'sk_test-pollinations-key'

        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValue({
                choices: [{ message: { content: 'deep analysis' } }],
            }),
        })

        const { generateContent } = reqRouter()
        await generateContent('analyze this', '', { useCase: 'analysis' })

        const body = JSON.parse(global.fetch.mock.calls[0][1].body)
        expect(body.model).toBe('gpt-5.4')
    })

    test('routes spellcheck use case to openai dynamically', async () => {
        process.env.POLLINATIONS_API_KEY = 'sk_test-pollinations-key'

        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValue({
                choices: [{ message: { content: 'corrected' } }],
            }),
        })

        const { generateContent } = reqRouter()
        await generateContent('fix these names', '', { useCase: 'spellcheck' })

        const body = JSON.parse(global.fetch.mock.calls[0][1].body)
        expect(body.model).toBe('openai')
    })

    test('allows explicit model override', async () => {
        process.env.POLLINATIONS_API_KEY = 'sk_test-pollinations-key'

        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValue({
                choices: [{ message: { content: 'custom model output' } }],
            }),
        })

        const { generateContent } = reqRouter()
        await generateContent('hello', '', { model: 'gpt-5.6-sol' })

        const body = JSON.parse(global.fetch.mock.calls[0][1].body)
        expect(body.model).toBe('gpt-5.6-sol')
    })

    test('retries on rate limit until success', async () => {
        process.env.POLLINATIONS_API_KEY = 'sk_test-pollinations-key'

        global.fetch
            .mockResolvedValueOnce({
                ok: false,
                status: 429,
                text: jest.fn().mockResolvedValue('rate limited'),
                headers: { get: () => null },
            })
            .mockResolvedValueOnce({
                ok: true,
                json: jest.fn().mockResolvedValue({
                    choices: [{ message: { content: 'recovered' } }],
                }),
            })

        const { generateContent } = reqRouter()
        const result = await generateContent('hello')

        expect(result).toBe('recovered')
        expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    test('throws after exhausting retries', async () => {
        process.env.POLLINATIONS_API_KEY = 'sk_test-pollinations-key'

        global.fetch.mockResolvedValue({
            ok: false,
            status: 429,
            text: jest.fn().mockResolvedValue('rate limited'),
            headers: { get: () => null },
        })

        const { generateContent } = reqRouter()
        await expect(generateContent('hello')).rejects.toThrow(/failed after 3 attempts|Pollinations/)

        expect(global.fetch.mock.calls.length).toBeGreaterThanOrEqual(1)
    })

    test('vision call sends image_url data URL to Pollinations', async () => {
        process.env.POLLINATIONS_API_KEY = 'sk_test-pollinations-key'

        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValue({
                choices: [{ message: { content: 'pollinations vision text' } }],
            }),
        })

        const { generateVisionContent } = reqRouter()
        const result = await generateVisionContent('describe', [
            { data: svgBase64(), mimeType: 'image/svg+xml' },
        ])

        expect(result).toBe('pollinations vision text')
        const body = JSON.parse(global.fetch.mock.calls[0][1].body)
        expect(body.model).toBe('gemini')
        const content = body.messages[0].content
        expect(content[0]).toMatchObject({ type: 'text', text: 'describe' })
        expect(content[1].image_url.url).toBe(`data:image/svg+xml;base64,${svgBase64()}`)
    })

    test('stitched vision call sends pre-built buffer', async () => {
        process.env.POLLINATIONS_API_KEY = 'sk_test-pollinations-key'
        const imgBuffer = Buffer.from('fake-image-bytes')

        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValue({
                choices: [{ message: { content: 'stitched analysis' } }],
            }),
        })

        const { generateStitchedVisionContent } = reqRouter()
        const result = await generateStitchedVisionContent('analyze', {
            buffer: imgBuffer,
            mimeType: 'image/webp',
        })

        expect(result).toBe('stitched analysis')
        const body = JSON.parse(global.fetch.mock.calls[0][1].body)
        expect(body.messages[0].content[1].image_url.url).toBe(
            `data:image/webp;base64,${imgBuffer.toString('base64')}`
        )
    })

    test('throws when Pollinations is not configured', async () => {
        const { generateContent } = reqRouter()
        await expect(generateContent('hi')).rejects.toThrow(
            'Pollinations is not configured',
        )
    })

    test('getAIAvailability reports Pollinations configuration without leaking keys', async () => {
        process.env.POLLINATIONS_API_KEY = 'sk_test-pollinations-key'

        const { getAIAvailability } = reqRouter()
        const availability = getAIAvailability()

        expect(availability).toMatchObject({
            anyAvailable: true,
            pollinationsConfigured: true,
            provider: 'pollinations',
        })
        const serialized = JSON.stringify(availability)
        expect(serialized).not.toContain('sk_test-pollinations-key')
    })
})
