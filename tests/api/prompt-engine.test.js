const ORIGINAL_ENV = process.env

describe('prompt engine', () => {
    beforeEach(() => {
        jest.resetModules()
        process.env = {
            ...ORIGINAL_ENV,
            POLLINATIONS_API_KEY: 'sk_prompt-test-key-ok',
        }

        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({
                choices: [{ message: { content: 'prompt-engine response' } }],
            })
        })
    })

    afterEach(() => {
        process.env = ORIGINAL_ENV
        delete global.fetch
        jest.restoreAllMocks()
    })

    test('can skip stored AI context and context persistence for whiteboard flows', async () => {
        const connectDBMock = jest.fn()
        const findMock = jest.fn()
        const createMock = jest.fn()

        jest.doMock('@/lib/mongodb', () => ({
            __esModule: true,
            default: connectDBMock
        }))

        jest.doMock('@/models/AIContext', () => ({
            __esModule: true,
            default: {
                find: findMock,
                create: createMock
            }
        }))

        const { generateSmartContent } = require('@/lib/promptEngine')

        const result = await generateSmartContent('Prepare a flowchart', {
            userId: 'user-1',
            feature: 'whiteboard-generate',
            skipRefinement: true,
            skipContext: true,
            skipSaveContext: true,
            skipGuardrails: true
        })

        expect(result).toBe('prompt-engine response')
        expect(global.fetch).toHaveBeenCalledTimes(1)
        const body = JSON.parse(global.fetch.mock.calls[0][1].body)
        expect(body.messages[0].content).toBe('Prepare a flowchart')
        expect(connectDBMock).not.toHaveBeenCalled()
        expect(findMock).not.toHaveBeenCalled()
        expect(createMock).not.toHaveBeenCalled()
    })
})