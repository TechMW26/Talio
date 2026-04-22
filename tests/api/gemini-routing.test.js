const ORIGINAL_ENV = process.env

function buildBase64Svg(fill) {
    return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="160" height="90">
      <rect width="160" height="90" fill="${fill}" />
    </svg>
  `).toString('base64')
}

describe('custom AI routing in gemini library', () => {
    beforeEach(() => {
        jest.resetModules()
        process.env = { ...ORIGINAL_ENV }

        delete process.env.CUSTOM_AI_API_KEY
        delete process.env.CUSTOM_AI_APP_TOKEN
        delete process.env.CUSTOM_AI_TOKEN
        delete process.env.CUSTOM_AI_BASE_URL

        global.fetch = jest.fn()
    })

    afterEach(() => {
        process.env = ORIGINAL_ENV
        delete global.fetch
        jest.restoreAllMocks()
    })

    test('generateContent uses the custom AI provider from environment configuration', async () => {
        process.env.CUSTOM_AI_APP_TOKEN = 'public-token'
        process.env.CUSTOM_AI_BASE_URL = 'http://custom-ai.test'

        global.fetch.mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({ success: true, result: 'custom text response' })
        })

        const { generateContent, getAIAvailability } = require('@/lib/gemini')

        const result = await generateContent('User prompt', 'System prompt')

        expect(result).toBe('custom text response')
        expect(global.fetch).toHaveBeenCalledTimes(1)

        const [url, request] = global.fetch.mock.calls[0]

        expect(url).toBe('http://custom-ai.test/public/analyze')
        expect(request).toMatchObject({
            method: 'POST',
            headers: { 'X-App-Token': 'public-token' }
        })
        expect(request.body).toBeInstanceOf(FormData)
        expect(request.body.get('prompt')).toBe('System prompt\n\nUser prompt')
        expect(getAIAvailability()).toMatchObject({
            customAI: true,
            customAIMode: 'public',
            anyAvailable: true
        })
    })

    test('generateContent fails when the custom AI environment is missing', async () => {
        const { generateContent, getAIAvailability } = require('@/lib/gemini')

        await expect(generateContent('User prompt')).rejects.toThrow(
            'Custom AI service is not configured. Set CUSTOM_AI_BASE_URL and either CUSTOM_AI_API_KEY or CUSTOM_AI_APP_TOKEN.'
        )
        expect(getAIAvailability()).toMatchObject({
            customAI: false,
            customAIMode: null,
            anyAvailable: false
        })
    })

    test('generateVisionContent uploads a composed image to the custom AI provider', async () => {
        process.env.CUSTOM_AI_API_KEY = 'protected-token'
        process.env.CUSTOM_AI_BASE_URL = 'http://custom-ai.test'

        global.fetch.mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({ success: true, result: 'vision response' })
        })

        const { generateVisionContent } = require('@/lib/gemini')

        const result = await generateVisionContent('Describe both screenshots', [
            { data: buildBase64Svg('#0EA5E9'), mimeType: 'image/svg+xml' },
            { data: buildBase64Svg('#2563EB'), mimeType: 'image/svg+xml' }
        ])

        expect(result).toBe('vision response')
        expect(global.fetch).toHaveBeenCalledTimes(1)

        const [url, request] = global.fetch.mock.calls[0]
        const upload = request.body.get('file')

        expect(url).toBe('http://custom-ai.test/v1/analyze')
        expect(request).toMatchObject({
            method: 'POST',
            headers: { 'X-API-KEY': 'protected-token' }
        })
        expect(request.body).toBeInstanceOf(FormData)
        expect(request.body.get('prompt')).toBe('Describe both screenshots')
        expect(upload).toBeTruthy()
        expect(upload.type).toBe('image/png')
        expect(upload.size).toBeGreaterThan(0)
    })
})