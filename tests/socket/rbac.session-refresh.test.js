jest.mock('../../lib/cache.js', () => ({
    buildCachePattern: jest.fn((params) => JSON.stringify(params)),
    clearCachePattern: jest.fn().mockResolvedValue(undefined),
}))

const { clearCachePattern } = require('../../lib/cache.js')
const { createTestSocketServer, createTestClient } = require('../helpers/socketHelper')
const { refreshAffectedUsers } = require('../../lib/rbacSessionRefresh.js')

describe('refreshAffectedUsers()', () => {
    let io
    let httpServer
    let port
    let onlineSocket

    beforeAll(async () => {
        ({ io, httpServer, port } = await createTestSocketServer())
    })

    afterAll(async () => {
        onlineSocket?.disconnect()
        io.close()
        await new Promise((resolve) => httpServer.close(resolve))
    })

    beforeEach(async () => {
        jest.clearAllMocks()
        onlineSocket = await createTestClient(port, 'online-user')
    })

    afterEach(() => {
        onlineSocket?.disconnect()
        onlineSocket = null
    })

    test('emits force-refresh to connected users and only queues offline users', async () => {
        const forceRefreshModel = {
            insertMany: jest.fn().mockResolvedValue(undefined),
        }

        const refreshEvent = new Promise((resolve) => {
            onlineSocket.once('force-refresh', resolve)
        })

        const resultPromise = refreshAffectedUsers({
            databaseName: 'talio_company_mushroom_world_group',
            userIds: ['online-user', 'offline-user'],
            initiatedBy: { userId: 'admin-1', email: 'taliohrms@gmail.com', role: 'admin' },
            message: 'Your access role was updated to Senior MIS Executive. Talio is applying the latest access in the background.',
            forceRefreshModel,
        })

        const [payload, result] = await Promise.all([refreshEvent, resultPromise])

        expect(payload).toMatchObject({
            type: 'force-refresh',
            hard: false,
            message: 'Your access role was updated to Senior MIS Executive. Talio is applying the latest access in the background.',
            initiatedBy: { userId: 'admin-1', email: 'taliohrms@gmail.com', role: 'admin' },
        })
        expect(result).toEqual({
            affectedUserIds: ['online-user', 'offline-user'],
            queuedCount: 1,
        })
        expect(forceRefreshModel.insertMany).toHaveBeenCalledWith([
            expect.objectContaining({
                userId: 'offline-user',
                consumed: false,
                hard: false,
            }),
        ])
        expect(clearCachePattern).toHaveBeenCalledTimes(8)
    })
})
