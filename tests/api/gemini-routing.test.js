const ORIGINAL_ENV = process.env

function buildBase64Svg(fill, width = 160, height = 90) {
    return Buffer.from(`
        <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
            <rect width="${width}" height="${height}" fill="${fill}" />
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
        delete process.env.CUSTOM_AI_API_URL
        delete process.env.CUSTOM_AI_CHAT_URL
        delete process.env.CUSTOM_AI_CHAT_API_KEY
        delete process.env.CUSTOM_AI_API_KEY_HEADER
        delete process.env.CUSTOM_AI_CHAT_IMAGE_FORMAT
        delete process.env.CUSTOM_AI_IMAGE_FORMAT
        delete process.env.CUSTOM_AI_ANALYSIS_ONLY
        delete process.env.AI_ANALYSIS_CUSTOM_ONLY
        delete process.env.CUSTOM_AI_REQUEST_FORMAT
        delete process.env.CUSTOM_AI_PROTOCOL
        delete process.env.CUSTOM_AI_MODEL
        delete process.env.CUSTOM_AI_STREAM
        delete process.env.CUSTOM_AI_MAX_TOKENS
        delete process.env.CUSTOM_AI_PUBLIC_PATH
        delete process.env.CUSTOM_AI_PROTECTED_PATH
        delete process.env.INFERENCE_API_KEY
        delete process.env.INFERENCE_APP_TOKEN
        delete process.env.INFERENCE_TOKEN
        delete process.env.INFERENCE_BASE_URL
        delete process.env.INFERENCE_PUBLIC_PATH
        delete process.env.INFERENCE_PROTECTED_PATH

        // Ensure Gemini fallback does not interfere with custom-AI-only
        // assertions. The router is the new entry point and would otherwise
        // try to recover from custom-AI failures by calling Gemini.
        for (const key of Object.keys(process.env)) {
            if (/^GEMINI_(API_)?KEY/i.test(key)) {
                delete process.env[key]
            }
        }
        delete process.env.GEMINI_API_KEY

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

    test('generateContent supports the chat-compatible custom AI protocol', async () => {
        process.env.CUSTOM_AI_REQUEST_FORMAT = 'chat'
        process.env.CUSTOM_AI_API_URL = 'https://salad.test/api/chat'
        process.env.CUSTOM_AI_CHAT_API_KEY = 'salad-token'
        process.env.CUSTOM_AI_API_KEY_HEADER = 'Salad-Api-Key'
        process.env.CUSTOM_AI_MODEL = 'llama3.2-vision'
        process.env.CUSTOM_AI_STREAM = 'true'
        process.env.CUSTOM_AI_MAX_TOKENS = '128'

        global.fetch.mockResolvedValue({
            ok: true,
            text: jest.fn().mockResolvedValue([
                'data: {"choices":[{"delta":{"content":"deep "}}]}',
                '',
                'data: {"choices":[{"delta":{"content":"learning"}}]}',
                '',
                'data: [DONE]',
            ].join('\n'))
        })

        const { generateContent } = require('@/lib/gemini')

        const result = await generateContent('What is deep learning?', 'You are a helpful assistant.')

        expect(result).toBe('deep learning')
        expect(global.fetch).toHaveBeenCalledTimes(1)

        const [url, request] = global.fetch.mock.calls[0]
        const body = JSON.parse(request.body)

        expect(url).toBe('https://salad.test/api/chat')
        expect(request).toMatchObject({
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Salad-Api-Key': 'salad-token'
            }
        })
        expect(body).toMatchObject({
            model: 'llama3.2-vision',
            stream: true,
            max_tokens: 128,
        })
        expect(body.messages).toEqual([
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'What is deep learning?' },
        ])
    })

    test('generateContent parses newline-delimited chat stream chunks', async () => {
        process.env.CUSTOM_AI_REQUEST_FORMAT = 'chat'
        process.env.CUSTOM_AI_API_URL = 'https://salad.test/api/chat'
        process.env.CUSTOM_AI_CHAT_API_KEY = 'salad-token'
        process.env.CUSTOM_AI_API_KEY_HEADER = 'Salad-Api-Key'

        global.fetch.mockResolvedValue({
            ok: true,
            text: jest.fn().mockResolvedValue([
                '{"message":{"role":"assistant","content":"Ready"},"done":false}',
                '{"message":{"role":"assistant","content":""},"done":true}',
            ].join('\n'))
        })

        const { generateContent } = require('@/lib/gemini')

        const result = await generateContent('Reply with the word ready.')

        expect(result).toBe('Ready')
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
        expect(upload.type).toBe('image/webp')
        expect(upload.size).toBeGreaterThan(0)
    })

    test('generateVisionContent normalizes a single large image before upload', async () => {
        process.env.CUSTOM_AI_APP_TOKEN = 'public-token'
        process.env.CUSTOM_AI_BASE_URL = 'http://custom-ai.test'

        global.fetch.mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({ success: true, result: 'single-image response' })
        })

        const { generateVisionContent } = require('@/lib/gemini')

        const result = await generateVisionContent('Describe this canvas screenshot', [
            { data: buildBase64Svg('#0EA5E9', 3200, 2400), mimeType: 'image/svg+xml' }
        ])

        expect(result).toBe('single-image response')
        expect(global.fetch).toHaveBeenCalledTimes(1)

        const upload = global.fetch.mock.calls[0][1].body.get('file')

        expect(upload).toBeTruthy()
        expect(upload.type).toBe('image/webp')
        expect(upload.size).toBeGreaterThan(0)
    })

    test('generateVisionContent sends images to chat-compatible custom AI endpoints', async () => {
        process.env.CUSTOM_AI_REQUEST_FORMAT = 'chat'
        process.env.CUSTOM_AI_API_URL = 'https://salad.test/api/chat'
        process.env.CUSTOM_AI_CHAT_API_KEY = 'salad-token'
        process.env.CUSTOM_AI_API_KEY_HEADER = 'Salad-Api-Key'
        process.env.CUSTOM_AI_CHAT_IMAGE_FORMAT = 'ollama'
        process.env.CUSTOM_AI_MODEL = 'llama3.2-vision'

        global.fetch.mockResolvedValue({
            ok: true,
            text: jest.fn().mockResolvedValue(JSON.stringify({
                choices: [{ message: { content: 'vision response' } }]
            }))
        })

        const { generateVisionContent } = require('@/lib/gemini')

        const result = await generateVisionContent('Describe this screenshot', [
            { data: buildBase64Svg('#0EA5E9'), mimeType: 'image/svg+xml' }
        ])

        expect(result).toBe('vision response')
        expect(global.fetch).toHaveBeenCalledTimes(1)

        const body = JSON.parse(global.fetch.mock.calls[0][1].body)
        const userMessage = body.messages[0]

        expect(userMessage.content).toBe('Describe this screenshot')
        expect(userMessage.images).toHaveLength(1)
        expect(userMessage.images[0]).toEqual(expect.any(String))
        expect(userMessage.images[0]).not.toContain('data:image')
    })


    test('generateContent falls back to the public custom AI route when the protected route returns a GPU engine error', async () => {
        process.env.CUSTOM_AI_API_KEY = 'protected-token'
        process.env.CUSTOM_AI_APP_TOKEN = 'public-token'
        process.env.CUSTOM_AI_BASE_URL = 'http://custom-ai.test'

        global.fetch
            .mockResolvedValueOnce({
                ok: false,
                status: 503,
                text: jest.fn().mockResolvedValue('{"detail":"GPU engine error"}')
            })
            .mockResolvedValueOnce({
                ok: false,
                status: 503,
                text: jest.fn().mockResolvedValue('{"detail":"GPU engine error"}')
            })
            .mockResolvedValueOnce({
                ok: true,
                json: jest.fn().mockResolvedValue({ success: true, result: 'fallback public response' })
            })

        const { generateContent, getAIAvailability } = require('@/lib/gemini')

        const result = await generateContent('User prompt', 'System prompt')

        expect(result).toBe('fallback public response')
        expect(global.fetch).toHaveBeenCalledTimes(3)
        expect(global.fetch.mock.calls[0][0]).toBe('http://custom-ai.test/v1/analyze')
        expect(global.fetch.mock.calls[1][0]).toBe('http://custom-ai.test/v1/analyze')
        expect(global.fetch.mock.calls[2][0]).toBe('http://custom-ai.test/public/analyze')
        expect(global.fetch.mock.calls[2][1]).toMatchObject({
            method: 'POST',
            headers: { 'X-App-Token': 'public-token' }
        })
        expect(getAIAvailability()).toMatchObject({
            customAI: true,
            customAIMode: 'protected',
            anyAvailable: true
        })
    })

    test('does not flag long structured content containing safety/blocked/harmful keywords as a refusal', async () => {
        process.env.CUSTOM_AI_API_KEY = 'protected-token'
        process.env.CUSTOM_AI_BASE_URL = 'http://custom-ai.test'

        const longMindmapResponse = JSON.stringify({
            sections: [
                {
                    title: 'Workplace Safety',
                    items: [
                        'Identify harmful behaviors',
                        'Document blocked exits',
                        'Escalations not allowed without approval',
                        'Track incidents that violate policy'
                    ]
                }
            ]
        })

        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValue({ success: true, result: longMindmapResponse })
        })

        const { generateContent } = require('@/lib/gemini')
        const result = await generateContent('Generate a mindmap about workplace safety')

        expect(result).toBe(longMindmapResponse)
        expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    test('falls back to public route when protected route returns an actual refusal', async () => {
        process.env.CUSTOM_AI_API_KEY = 'protected-token'
        process.env.CUSTOM_AI_APP_TOKEN = 'public-token'
        process.env.CUSTOM_AI_BASE_URL = 'http://custom-ai.test'

        global.fetch
            .mockResolvedValueOnce({
                ok: true,
                json: jest.fn().mockResolvedValue({ success: true, result: "I'm sorry, but I can't help with that request." })
            })
            .mockResolvedValueOnce({
                ok: true,
                json: jest.fn().mockResolvedValue({ success: true, result: 'public mode answer' })
            })

        const { generateContent } = require('@/lib/gemini')
        const result = await generateContent('Anything')

        expect(result).toBe('public mode answer')
        expect(global.fetch).toHaveBeenCalledTimes(2)
        expect(global.fetch.mock.calls[0][0]).toBe('http://custom-ai.test/v1/analyze')
        expect(global.fetch.mock.calls[1][0]).toBe('http://custom-ai.test/public/analyze')
    })

    test('surfaces actionable network errors when the custom AI host is unreachable', async () => {
        process.env.CUSTOM_AI_APP_TOKEN = 'public-token'
        process.env.CUSTOM_AI_BASE_URL = 'http://custom-ai.test'

        const fetchError = new Error('fetch failed')
        fetchError.cause = { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 1.2.3.4:34906' }
        global.fetch.mockRejectedValue(fetchError)

        const { generateVisionContent } = require('@/lib/gemini')

        await expect(generateVisionContent('Describe image', [
            { data: buildBase64Svg('#0EA5E9'), mimeType: 'image/svg+xml' }
        ])).rejects.toThrow('Custom AI service unreachable (ECONNREFUSED): connect ECONNREFUSED 1.2.3.4:34906')
    })
})