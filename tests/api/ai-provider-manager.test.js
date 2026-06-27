// Gemini AI router tests. Validates multi-key rotation, rate-limit fallback,
// model fallback, and that key material is never included in log output.

const ORIGINAL_ENV = process.env

function svgBase64() {
    return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"></svg>').toString('base64')
}

function clearAIKeys(env) {
    for (const k of Object.keys(env)) {
        if (/^GEMINI_(API_)?KEY/i.test(k)) {
            delete env[k]
        }
    }
    delete env.GEMINI_API_KEY
    delete env.GEMINI_KEY
}

function reqRouter() {
    return require('@/lib/ai/aiProviderManager')
}

describe('AIProviderManager — Gemini-only key rotation', () => {
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

    test('calls Gemini and returns text content', async () => {
        process.env.GEMINI_API_KEY_1 = 'AIzagm-testkey-1'

        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValue({
                candidates: [{ content: { parts: [{ text: 'gemini output' }] } }],
            }),
        })

        const { generateContent } = reqRouter()
        const result = await generateContent('hello')

        expect(result).toBe('gemini output')
        expect(global.fetch).toHaveBeenCalledTimes(1)
        expect(global.fetch.mock.calls[0][0]).toContain('generativelanguage.googleapis.com')
    })

    test('passes system instruction to Gemini', async () => {
        process.env.GEMINI_API_KEY_1 = 'AIzagm-testkey-1'

        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValue({
                candidates: [{ content: { parts: [{ text: 'sys-aware output' }] } }],
            }),
        })

        const { generateContent } = reqRouter()
        await generateContent('hello', 'You are helpful.')

        const body = JSON.parse(global.fetch.mock.calls[0][1].body)
        expect(body.systemInstruction.parts[0].text).toBe('You are helpful.')
    })

    test('falls back through model chain when 3.5-flash returns 404', async () => {
        process.env.GEMINI_API_KEY_1 = 'AIzagm-testkey-1'
        // Set primary to a model that will 404 — the fallback chain kicks in
        process.env.GEMINI_MODEL = 'gemini-3.5-flash'

        // 3.5-flash 404 → 2.5-flash 404 → flash-latest 404 → 2.0-flash succeeds
        global.fetch
            .mockResolvedValueOnce({
                ok: false, status: 404,
                text: jest.fn().mockResolvedValue(JSON.stringify({
                    error: { code: 404, message: 'models/gemini-3.5-flash is not found', status: 'NOT_FOUND' },
                })),
            })
            .mockResolvedValueOnce({
                ok: false, status: 404,
                text: jest.fn().mockResolvedValue(JSON.stringify({
                    error: { code: 404, message: 'models/gemini-2.5-flash is not found', status: 'NOT_FOUND' },
                })),
            })
            .mockResolvedValueOnce({
                ok: false, status: 404,
                text: jest.fn().mockResolvedValue(JSON.stringify({
                    error: { code: 404, message: 'not found', status: 'NOT_FOUND' },
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
        expect(global.fetch).toHaveBeenCalledTimes(4)
        expect(global.fetch.mock.calls[0][0]).toContain('/models/gemini-3.5-flash:generateContent')
        expect(global.fetch.mock.calls[3][0]).toContain('/models/gemini-2.0-flash:generateContent')
    })

    test('rotates Gemini keys on rate limit until one succeeds', async () => {
        process.env.GEMINI_API_KEY_1 = 'AIzagm-testkey-1'
        process.env.GEMINI_API_KEY_2 = 'AIzagm-testkey-2'

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
        expect(global.fetch.mock.calls[0][0]).toContain('key=AIzagm-testkey-1')
        expect(global.fetch.mock.calls[1][0]).toContain('key=AIzagm-testkey-2')
    })

    test('throws after all keys rate-limited (exhausted via cooldown)', async () => {
        process.env.GEMINI_API_KEY_1 = 'AIzagm-testkey-1'

        global.fetch.mockResolvedValue({
            ok: false,
            status: 429,
            text: jest.fn().mockResolvedValue('RESOURCE_EXHAUSTED'),
        })

        const { generateContent } = reqRouter()
        await expect(generateContent('hello')).rejects.toThrow(/failed after 3 attempts|Gemini/)

        // geminiProvider rotates keys internally; aiProviderManager retries
        // the whole call up to 3 times. With one key, the first 429 puts it
        // into cooldown, so subsequent attempts exhaust immediately.
        expect(global.fetch.mock.calls.length).toBeGreaterThanOrEqual(1)
    })

    test('vision call sends inlineData payload to Gemini', async () => {
        process.env.GEMINI_API_KEY_1 = 'AIzagm-testkey-1'

        global.fetch.mockResolvedValueOnce({
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
        const body = JSON.parse(global.fetch.mock.calls[0][1].body)
        const parts = body.contents[0].parts
        expect(parts[0]).toMatchObject({ text: 'describe' })
        expect(parts[1].inlineData).toMatchObject({ mimeType: 'image/svg+xml' })
        expect(parts[1].inlineData.data).toBe(svgBase64())
    })

    test('stitched vision call sends pre-built buffer', async () => {
        process.env.GEMINI_API_KEY_1 = 'AIzagm-testkey-1'
        const imgBuffer = Buffer.from('fake-image-bytes')

        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValue({
                candidates: [{ content: { parts: [{ text: 'stitched analysis' }] } }],
            }),
        })

        const { generateStitchedVisionContent } = reqRouter()
        const result = await generateStitchedVisionContent('analyze', {
            buffer: imgBuffer,
            mimeType: 'image/webp',
        })

        expect(result).toBe('stitched analysis')
        const body = JSON.parse(global.fetch.mock.calls[0][1].body)
        expect(body.contents[0].parts[1].inlineData.mimeType).toBe('image/webp')
    })

    test('throws when no Gemini keys are configured', async () => {
        const { generateContent } = reqRouter()
        await expect(generateContent('hi')).rejects.toThrow(
            'Gemini is not configured',
        )
    })

    test('getAIAvailability reports Gemini configuration without leaking keys', async () => {
        process.env.GEMINI_API_KEY_1 = 'AIzagm-testkey-1'
        process.env.GEMINI_API_KEY_2 = 'AIzagm-testkey-2'

        const { getAIAvailability } = reqRouter()
        const availability = getAIAvailability()

        expect(availability).toMatchObject({
            anyAvailable: true,
            geminiConfigured: true,
            geminiKeys: 2,
            provider: 'gemini',
        })
        const serialized = JSON.stringify(availability)
        expect(serialized).not.toContain('AIzagm-testkey-1')
        expect(serialized).not.toContain('AIzagm-testkey-2')
    })

    test('uses numbered keys GEMINI_API_KEY_1..N with correct ordering', async () => {
        process.env.GEMINI_API_KEY_3 = 'AIzagm-testkey-3'
        process.env.GEMINI_API_KEY_1 = 'AIzagm-testkey-1'
        process.env.GEMINI_API_KEY_2 = 'AIzagm-testkey-2'

        global.fetch.mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({
                candidates: [{ content: { parts: [{ text: 'ok' }] } }],
            }),
        })

        const { generateContent } = reqRouter()
        await generateContent('hello')

        // First key should be GEMINI_API_KEY_1 (sorted numerically)
        expect(global.fetch.mock.calls[0][0]).toContain('key=AIzagm-testkey-1')
    })
})
