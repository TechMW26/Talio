// Multi-provider AI router tests. Validates Custom AI → Gemini fallback
// ordering, multi-key rotation across Gemini keys, and that key material is
// never included in log output.

const ORIGINAL_ENV = process.env

function svgBase64() {
    return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"></svg>').toString('base64')
}

function clearAIKeys(env) {
    delete env.CUSTOM_AI_API_KEY
    delete env.CUSTOM_AI_APP_TOKEN
    delete env.CUSTOM_AI_TOKEN
    delete env.CUSTOM_AI_BASE_URL
    for (const k of Object.keys(env)) {
        if (/^GEMINI_(API_)?KEY/i.test(k)) {
            delete env[k]
        }
    }
    delete env.GEMINI_API_KEY
}

function reqRouter() {
    return require('@/lib/ai/aiProviderManager')
}

describe('AIProviderManager fallback routing (Custom AI → Gemini)', () => {
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

    test('uses Custom AI when it succeeds (no fallback triggered)', async () => {
        process.env.CUSTOM_AI_BASE_URL = 'http://custom.test'
        process.env.CUSTOM_AI_APP_TOKEN = 'tok'
        process.env.GEMINI_API_KEY = 'gem-1'

        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValue({ success: true, result: 'custom output' }),
        })

        const { generateContent } = reqRouter()
        const result = await generateContent('hello')

        expect(result).toBe('custom output')
        expect(global.fetch).toHaveBeenCalledTimes(1)
        expect(global.fetch.mock.calls[0][0]).toBe('http://custom.test/public/analyze')
    })

    test('falls back to Gemini when Custom AI is unreachable', async () => {
        process.env.CUSTOM_AI_BASE_URL = 'http://custom.test'
        process.env.CUSTOM_AI_APP_TOKEN = 'tok'
        process.env.GEMINI_API_KEY = 'gem-1'

        const netError = new Error('fetch failed')
        netError.cause = { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' }

        global.fetch
            .mockRejectedValueOnce(netError)
            .mockResolvedValueOnce({
                ok: true,
                json: jest.fn().mockResolvedValue({
                    candidates: [{ content: { parts: [{ text: 'gemini rescue text' }] } }],
                }),
            })

        const { generateContent } = reqRouter()
        const result = await generateContent('hello', 'sys')

        expect(result).toBe('gemini rescue text')
        expect(global.fetch).toHaveBeenCalledTimes(2)
        const lastCall = global.fetch.mock.calls.at(-1)
        expect(lastCall[0]).toContain('generativelanguage.googleapis.com')
        expect(lastCall[0]).toContain('key=gem-1')
        for (const call of warnSpy.mock.calls) {
            expect(call.join(' ')).not.toContain('gem-1')
        }
    })

    test('falls back to a supported Gemini model when the preferred model returns 404', async () => {
        process.env.GEMINI_API_KEY = 'gem-1'
        process.env.GEMINI_MODEL = 'gemini-1.5-flash'

        global.fetch
            .mockResolvedValueOnce({
                ok: false,
                status: 404,
                text: jest.fn().mockResolvedValue(JSON.stringify({
                    error: {
                        code: 404,
                        message: 'models/gemini-1.5-flash is not found for API version v1beta, or is not supported for generateContent. Call ListModels to see the list of available models and their supported methods.',
                        status: 'NOT_FOUND',
                    },
                })),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: jest.fn().mockResolvedValue({
                    candidates: [{ content: { parts: [{ text: 'fallback model works' }] } }],
                }),
            })

        const { generateContent } = reqRouter()
        const result = await generateContent('hello')

        expect(result).toBe('fallback model works')
        expect(global.fetch).toHaveBeenCalledTimes(2)
        expect(global.fetch.mock.calls[0][0]).toContain('/models/gemini-1.5-flash:generateContent')
        expect(global.fetch.mock.calls[1][0]).toContain('/models/gemini-2.0-flash:generateContent')
    })

    test('rotates Gemini keys on rate limit until one succeeds', async () => {
        process.env.GEMINI_API_KEY = 'gem-1'
        process.env.GEMINI_API_KEY_2 = 'gem-2'

        global.fetch
            .mockResolvedValueOnce({
                ok: false,
                status: 429,
                text: jest.fn().mockResolvedValue('RESOURCE_EXHAUSTED'),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: jest.fn().mockResolvedValue({
                    candidates: [{ content: { parts: [{ text: 'second key wins' }] } }],
                }),
            })

        const { generateContent } = reqRouter()
        const result = await generateContent('hello')

        expect(result).toBe('second key wins')
        expect(global.fetch).toHaveBeenCalledTimes(2)
        expect(global.fetch.mock.calls[0][0]).toContain('key=gem-1')
        expect(global.fetch.mock.calls[1][0]).toContain('key=gem-2')
    })

    test('vision routing falls back from Custom to Gemini with inlineData payload', async () => {
        process.env.CUSTOM_AI_BASE_URL = 'http://custom.test'
        process.env.CUSTOM_AI_APP_TOKEN = 'tok'
        process.env.GEMINI_API_KEY = 'gem-1'

        const netError = new Error('fetch failed')
        netError.cause = { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' }

        global.fetch
            .mockRejectedValueOnce(netError)
            .mockResolvedValueOnce({
                ok: true,
                json: jest.fn().mockResolvedValue({
                    candidates: [{ content: { parts: [{ text: 'gemini vision text' }] } }],
                }),
            })

        const { generateVisionContent } = reqRouter()
        const result = await generateVisionContent('describe', [
            { data: svgBase64(), mimeType: 'image/svg+xml' },
        ])

        expect(result).toBe('gemini vision text')
        expect(global.fetch).toHaveBeenCalledTimes(2)
        const geminiCall = global.fetch.mock.calls.at(-1)
        const body = JSON.parse(geminiCall[1].body)
        const parts = body.contents[0].parts
        expect(parts[0]).toMatchObject({ text: 'describe' })
        expect(parts[1].inlineData).toMatchObject({ mimeType: 'image/svg+xml' })
        expect(parts[1].inlineData.data).toBe(svgBase64())
    })

    test('throws Custom AI config error when no providers are configured', async () => {
        const { generateContent } = reqRouter()
        await expect(generateContent('hi')).rejects.toThrow(
            'Custom AI service is not configured. Set CUSTOM_AI_BASE_URL and either CUSTOM_AI_API_KEY or CUSTOM_AI_APP_TOKEN.',
        )
    })

    test('getAIAvailability reports provider configuration without leaking keys', async () => {
        process.env.CUSTOM_AI_BASE_URL = 'http://custom.test'
        process.env.CUSTOM_AI_APP_TOKEN = 'tok'
        process.env.GEMINI_API_KEY = 'gem-1'
        process.env.GEMINI_API_KEY_2 = 'gem-2'

        const { getAIAvailability } = reqRouter()
        const availability = getAIAvailability()

        expect(availability).toMatchObject({
            customAI: true,
            anyAvailable: true,
            providers: {
                custom: { configured: true },
                gemini: { configured: true, keys: 2 },
            },
        })
        expect(availability.providers.openai).toBeUndefined()
        const serialized = JSON.stringify(availability)
        expect(serialized).not.toContain('gem-1')
        expect(serialized).not.toContain('gem-2')
    })
})
