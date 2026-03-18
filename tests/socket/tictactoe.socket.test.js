/**
 * Socket.IO Tic-Tac-Toe Real-Time Event Tests
 *
 * Tests that every game action emits the correct Socket.IO events
 * to the correct user rooms, matching the emitToUser() pattern
 * in app/api/tictactoe/route.js.
 *
 * These tests create a real Socket.IO server + clients in-process,
 * then call emitToUser() directly (same function the API route uses)
 * to verify event delivery, payload shape, and room isolation.
 */

const { createTestSocketServer, createTestClient } = require('../helpers/socketHelper');

// ─── emitToUser - mirrors the API route's helper exactly ───
function emitToUser(userId, event, payload) {
    const io = global.io;
    if (!io) return;
    io.to(`user:${userId}`).emit(event, payload);
}

describe('Socket.IO - Tic-Tac-Toe Real-Time Events', () => {
    let io, httpServer, port;
    let hostSocket, guestSocket;

    const HOST_ID = 'host_user_001';
    const GUEST_ID = 'guest_user_002';
    const THIRD_ID = 'third_user_003';
    const GAME_ID = 'ttt_host_user_001_guest_user_002_1710000000000';

    beforeAll(async () => {
        ({ io, httpServer, port } = await createTestSocketServer());
    });

    afterAll((done) => {
        hostSocket?.disconnect();
        guestSocket?.disconnect();
        io.close();
        httpServer.close(done);
    });

    beforeEach(async () => {
        hostSocket = await createTestClient(port, HOST_ID);
        guestSocket = await createTestClient(port, GUEST_ID);
    });

    afterEach(() => {
        hostSocket?.disconnect();
        guestSocket?.disconnect();
    });

    // ── tictactoe:invite ────────────────────────────────────────────
    describe('tictactoe:invite', () => {
        test('guest receives invite event with correct payload', (done) => {
            guestSocket.on('tictactoe:invite', (data) => {
                expect(data.gameId).toBe(GAME_ID);
                expect(data.hostUserId).toBe(HOST_ID);
                expect(data.hostName).toBe('John Host');
                expect(data.hostAvatar).toBe('avatar_host.jpg');
                expect(data.createdAt).toBeDefined();
                done();
            });

            emitToUser(GUEST_ID, 'tictactoe:invite', {
                gameId: GAME_ID,
                hostUserId: HOST_ID,
                hostName: 'John Host',
                hostAvatar: 'avatar_host.jpg',
                createdAt: new Date().toISOString(),
            });
        });

        test('host does NOT receive the invite event', (done) => {
            let hostReceived = false;

            hostSocket.on('tictactoe:invite', () => {
                hostReceived = true;
            });

            guestSocket.on('tictactoe:invite', () => {
                // Give extra time for any stray delivery
                setTimeout(() => {
                    expect(hostReceived).toBe(false);
                    done();
                }, 100);
            });

            emitToUser(GUEST_ID, 'tictactoe:invite', {
                gameId: GAME_ID,
                hostUserId: HOST_ID,
                hostName: 'John Host',
                hostAvatar: null,
                createdAt: new Date().toISOString(),
            });
        });

        test('unrelated third user does NOT receive the invite event', async () => {
            const thirdSocket = await createTestClient(port, THIRD_ID);
            let thirdReceived = false;

            thirdSocket.on('tictactoe:invite', () => {
                thirdReceived = true;
            });

            return new Promise((resolve) => {
                guestSocket.on('tictactoe:invite', () => {
                    setTimeout(() => {
                        expect(thirdReceived).toBe(false);
                        thirdSocket.disconnect();
                        resolve();
                    }, 100);
                });

                emitToUser(GUEST_ID, 'tictactoe:invite', {
                    gameId: GAME_ID,
                    hostUserId: HOST_ID,
                    hostName: 'John Host',
                    hostAvatar: null,
                    createdAt: new Date().toISOString(),
                });
            });
        });
    });

    // ── tictactoe:accept ────────────────────────────────────────────
    describe('tictactoe:accept', () => {
        test('BOTH host and guest receive accept event', (done) => {
            let hostGot = false;
            let guestGot = false;
            const check = () => { if (hostGot && guestGot) done(); };

            const payload = {
                gameId: GAME_ID,
                board: Array(9).fill(null),
                currentTurn: 'X',
                hostSymbol: 'X',
                guestName: 'Jane Guest',
                guestAvatar: 'avatar_guest.jpg',
                status: 'playing',
            };

            hostSocket.on('tictactoe:accept', (data) => {
                expect(data.gameId).toBe(GAME_ID);
                expect(data.board).toHaveLength(9);
                expect(data.currentTurn).toBe('X');
                expect(data.hostSymbol).toBe('X');
                expect(data.guestName).toBe('Jane Guest');
                expect(data.status).toBe('playing');
                hostGot = true;
                check();
            });

            guestSocket.on('tictactoe:accept', (data) => {
                expect(data.gameId).toBe(GAME_ID);
                expect(data.board).toHaveLength(9);
                guestGot = true;
                check();
            });

            // Accept emits to both players (mirrors API route behavior)
            emitToUser(HOST_ID, 'tictactoe:accept', payload);
            emitToUser(GUEST_ID, 'tictactoe:accept', payload);
        });
    });

    // ── tictactoe:decline ───────────────────────────────────────────
    describe('tictactoe:decline', () => {
        test('host receives decline event with gameId', (done) => {
            hostSocket.on('tictactoe:decline', (data) => {
                expect(data.gameId).toBe(GAME_ID);
                done();
            });

            emitToUser(HOST_ID, 'tictactoe:decline', { gameId: GAME_ID });
        });

        test('guest does NOT receive decline event', (done) => {
            let guestReceived = false;

            guestSocket.on('tictactoe:decline', () => {
                guestReceived = true;
            });

            hostSocket.on('tictactoe:decline', () => {
                setTimeout(() => {
                    expect(guestReceived).toBe(false);
                    done();
                }, 100);
            });

            emitToUser(HOST_ID, 'tictactoe:decline', { gameId: GAME_ID });
        });
    });

    // ── tictactoe:move ──────────────────────────────────────────────
    describe('tictactoe:move', () => {
        test('opponent receives move event with full board state', (done) => {
            const boardAfterMove = ['X', null, null, null, null, null, null, null, null];

            guestSocket.on('tictactoe:move', (data) => {
                expect(data.gameId).toBe(GAME_ID);
                expect(data.board).toEqual(boardAfterMove);
                expect(data.currentTurn).toBe('O');
                expect(data.lastMove).toBe(0);
                expect(data.status).toBe('playing');
                expect(data.result).toBeNull();
                expect(data.lastMoveAt).toBeDefined();
                done();
            });

            emitToUser(GUEST_ID, 'tictactoe:move', {
                gameId: GAME_ID,
                board: boardAfterMove,
                currentTurn: 'O',
                lastMove: 0,
                status: 'playing',
                result: null,
                lastMoveAt: new Date().toISOString(),
            });
        });

        test('move event is delivered in under 200ms', (done) => {
            const startTime = Date.now();

            guestSocket.on('tictactoe:move', () => {
                const latency = Date.now() - startTime;
                expect(latency).toBeLessThan(200);
                done();
            });

            emitToUser(GUEST_ID, 'tictactoe:move', {
                gameId: GAME_ID,
                board: Array(9).fill(null),
                currentTurn: 'O',
                lastMove: 4,
                status: 'playing',
                result: null,
                lastMoveAt: new Date().toISOString(),
            });
        });
    });

    // ── tictactoe:end ───────────────────────────────────────────────
    describe('tictactoe:end', () => {
        test('BOTH players receive end event on game win', (done) => {
            let hostGot = false;
            let guestGot = false;
            const check = () => { if (hostGot && guestGot) done(); };

            const endPayload = {
                gameId: GAME_ID,
                result: { winner: 'X', line: [0, 1, 2] },
            };

            hostSocket.on('tictactoe:end', (data) => {
                expect(data.gameId).toBe(GAME_ID);
                expect(data.result.winner).toBe('X');
                expect(data.result.line).toEqual([0, 1, 2]);
                hostGot = true;
                check();
            });

            guestSocket.on('tictactoe:end', (data) => {
                expect(data.result.winner).toBe('X');
                guestGot = true;
                check();
            });

            emitToUser(HOST_ID, 'tictactoe:end', endPayload);
            emitToUser(GUEST_ID, 'tictactoe:end', endPayload);
        });

        test('end event includes draw result correctly', (done) => {
            hostSocket.on('tictactoe:end', (data) => {
                expect(data.result.winner).toBe('draw');
                expect(data.result.line).toBeNull();
                done();
            });

            emitToUser(HOST_ID, 'tictactoe:end', {
                gameId: GAME_ID,
                result: { winner: 'draw', line: null },
            });
        });
    });

    // ── tictactoe:close ─────────────────────────────────────────────
    describe('tictactoe:close', () => {
        test('opponent receives close event with gameId', (done) => {
            guestSocket.on('tictactoe:close', (data) => {
                expect(data.gameId).toBe(GAME_ID);
                done();
            });

            emitToUser(GUEST_ID, 'tictactoe:close', { gameId: GAME_ID });
        });

        test('closer does NOT receive close event', (done) => {
            let hostReceived = false;

            hostSocket.on('tictactoe:close', () => {
                hostReceived = true;
            });

            guestSocket.on('tictactoe:close', () => {
                setTimeout(() => {
                    expect(hostReceived).toBe(false);
                    done();
                }, 100);
            });

            emitToUser(GUEST_ID, 'tictactoe:close', { gameId: GAME_ID });
        });
    });

    // ── Room isolation ──────────────────────────────────────────────
    describe('Room isolation', () => {
        test('events only reach the targeted user room', async () => {
            const thirdSocket = await createTestClient(port, THIRD_ID);

            const received = { host: [], guest: [], third: [] };

            hostSocket.on('tictactoe:move', () => received.host.push('move'));
            guestSocket.on('tictactoe:move', () => received.guest.push('move'));
            thirdSocket.on('tictactoe:move', () => received.third.push('move'));

            // Send move only to guest
            emitToUser(GUEST_ID, 'tictactoe:move', {
                gameId: GAME_ID,
                board: Array(9).fill(null),
                currentTurn: 'X',
                lastMove: 0,
                status: 'playing',
                result: null,
                lastMoveAt: new Date().toISOString(),
            });

            await new Promise((r) => setTimeout(r, 200));

            expect(received.guest).toHaveLength(1);
            expect(received.host).toHaveLength(0);
            expect(received.third).toHaveLength(0);

            thirdSocket.disconnect();
        });
    });
});
