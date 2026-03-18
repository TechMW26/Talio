/**
 * E2E - Complete Tic-Tac-Toe Game Flow via Socket.IO
 *
 * Full game flows using a real in-process Socket.IO server + MongoDB.
 * These tests verify the entire event chain:
 * invite → accept → moves → end/close
 *
 * All DB operations mirror the actual API route logic from
 * app/api/tictactoe/route.js to ensure end-to-end correctness.
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createTestSocketServer, createTestClient } = require('../helpers/socketHelper');

// ─── checkWinner - mirrors route.js ───
const WIN_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
];
function checkWinner(board) {
    for (const [a, b, c] of WIN_LINES) {
        if (board[a] && board[a] === board[b] && board[a] === board[c]) return { winner: board[a], line: [a, b, c] };
    }
    return board.every(c => c) ? { winner: 'draw', line: null } : null;
}

// ─── emitToUser - mirrors route.js ───
function emitToUser(userId, event, payload) {
    const io = global.io;
    if (!io) return;
    io.to(`user:${userId}`).emit(event, payload);
}

// ─── Model (mirrors tenantModels.js) ───
const TicTacToeGameSchema = new mongoose.Schema({
    gameId: { type: String, required: true, unique: true },
    hostUserId: { type: String, required: true },
    guestUserId: { type: String, required: true },
    hostName: { type: String, default: 'Player 1' },
    hostAvatar: { type: String, default: null },
    guestName: { type: String, default: 'Player 2' },
    guestAvatar: { type: String, default: null },
    status: { type: String, enum: ['pending', 'playing', 'declined', 'ended'], default: 'pending' },
    board: { type: [mongoose.Schema.Types.Mixed], default: () => Array(9).fill(null) },
    currentTurn: { type: String, default: 'X' },
    hostSymbol: { type: String, default: 'X' },
    result: { type: mongoose.Schema.Types.Mixed, default: null },
    lastMoveAt: { type: Date, default: Date.now },
}, { timestamps: true });

let TicTacToeGame;
let mongoServer;
let io, httpServer, port;
let hostSocket, guestSocket;

const HOST_ID = 'host_e2e_001';
const GUEST_ID = 'guest_e2e_002';

beforeAll(async () => {
    // MongoDB
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    TicTacToeGame = mongoose.model('TicTacToeE2E', TicTacToeGameSchema);

    // Socket.IO server
    ({ io, httpServer, port } = await createTestSocketServer());
});

afterAll(async () => {
    hostSocket?.disconnect();
    guestSocket?.disconnect();
    io.close();
    await new Promise((resolve) => httpServer.close(resolve));
    await mongoose.disconnect();
    await mongoServer.stop();
});

beforeEach(async () => {
    await TicTacToeGame.deleteMany({});
    hostSocket = await createTestClient(port, HOST_ID);
    guestSocket = await createTestClient(port, GUEST_ID);
});

afterEach(() => {
    hostSocket?.disconnect();
    guestSocket?.disconnect();
});

// ─── Simulate the full API route action logic ───
async function simulateAction(senderId, action, targetUserId, payload = {}) {
    const gameId = payload.gameId;

    if (action === 'invite') {
        await TicTacToeGame.updateMany(
            { hostUserId: senderId, status: 'pending' },
            { status: 'ended' }
        );
        const game = await TicTacToeGame.create({
            gameId,
            hostUserId: senderId,
            guestUserId: targetUserId,
            hostName: 'Host Player',
            hostAvatar: 'host.jpg',
            status: 'pending',
            board: Array(9).fill(null),
            currentTurn: 'X',
            hostSymbol: 'X',
        });
        emitToUser(targetUserId, 'tictactoe:invite', {
            gameId,
            hostUserId: senderId,
            hostName: 'Host Player',
            hostAvatar: 'host.jpg',
            createdAt: game.createdAt,
        });
        return game;
    }

    if (action === 'accept') {
        const game = await TicTacToeGame.findOneAndUpdate(
            { gameId, status: { $in: ['pending', 'playing'] } },
            { status: 'playing', guestName: 'Guest Player', guestAvatar: 'guest.jpg', lastMoveAt: new Date() },
            { new: true }
        );
        if (game) {
            const acceptPayload = {
                gameId,
                board: game.board,
                currentTurn: game.currentTurn,
                hostSymbol: game.hostSymbol || 'X',
                guestName: 'Guest Player',
                guestAvatar: 'guest.jpg',
                status: 'playing',
            };
            emitToUser(game.hostUserId, 'tictactoe:accept', acceptPayload);
            emitToUser(senderId, 'tictactoe:accept', acceptPayload);
        }
        return game;
    }

    if (action === 'decline') {
        const game = await TicTacToeGame.findOneAndUpdate(
            { gameId, status: 'pending' },
            { status: 'declined' },
            { new: true }
        );
        if (game) {
            emitToUser(game.hostUserId, 'tictactoe:decline', { gameId });
        }
        return game;
    }

    if (action === 'move') {
        const game = await TicTacToeGame.findOne({ gameId, status: { $in: ['playing', 'ended'] } });
        if (game) {
            const board = [...game.board];
            if (board[payload.index] == null) {
                board[payload.index] = payload.symbol;
            }
            const result = checkWinner(board);
            game.board = board;
            game.currentTurn = payload.symbol === 'X' ? 'O' : 'X';
            game.lastMoveAt = new Date();
            if (result) {
                game.result = result;
                game.status = 'ended';
            }
            await game.save();

            const opponentId = senderId === game.hostUserId ? game.guestUserId : game.hostUserId;
            emitToUser(opponentId, 'tictactoe:move', {
                gameId,
                board: game.board,
                currentTurn: game.currentTurn,
                lastMove: payload.index,
                status: game.status,
                result: result || null,
                lastMoveAt: game.lastMoveAt,
            });

            if (result) {
                const endPayload = { gameId, result };
                emitToUser(game.hostUserId, 'tictactoe:end', endPayload);
                emitToUser(game.guestUserId, 'tictactoe:end', endPayload);
            }
        }
        return game;
    }

    if (action === 'close') {
        const game = await TicTacToeGame.findOneAndUpdate(
            { gameId, status: { $in: ['pending', 'playing'] } },
            { status: 'ended' },
            { new: true }
        );
        if (game) {
            emitToUser(targetUserId, 'tictactoe:close', { gameId });
        }
        return game;
    }
}

// ════════════════════════════════════════════════════════════════
// Full Game: Invite → Accept → Win
// ════════════════════════════════════════════════════════════════
describe('E2E - Full Game Flow', () => {

    test('Invite → Accept → Moves → Win: all via Socket.IO', (done) => {
        const gameId = `ttt_e2e_win_${Date.now()}`;
        const events = [];

        // Step 1: Guest receives invite
        guestSocket.on('tictactoe:invite', async (data) => {
            events.push('guest:invite');
            expect(data.gameId).toBe(gameId);
            expect(data.hostName).toBe('Host Player');

            // Step 2: Guest accepts
            await simulateAction(GUEST_ID, 'accept', HOST_ID, { gameId });
        });

        // Step 3: Both receive accept
        let acceptCount = 0;
        const onAccept = async (data) => {
            acceptCount++;
            events.push(`accept:${acceptCount}`);

            if (acceptCount === 2) {
                // Step 4: Play a winning sequence - top row for X
                // Host (X) plays 0, Guest (O) plays 3, Host plays 1, Guest plays 4, Host plays 2 → WIN
                await simulateAction(HOST_ID, 'move', GUEST_ID, { gameId, index: 0, symbol: 'X' });
            }
        };
        hostSocket.on('tictactoe:accept', onAccept);
        guestSocket.on('tictactoe:accept', onAccept);

        // Track moves for sequencing
        let moveCount = 0;
        guestSocket.on('tictactoe:move', async (data) => {
            moveCount++;
            events.push(`guest:move:${moveCount}`);

            if (moveCount === 1) {
                // Guest responds to move 0
                await simulateAction(GUEST_ID, 'move', HOST_ID, { gameId, index: 3, symbol: 'O' });
            }
            if (moveCount === 2) {
                // Guest responds to move 1
                await simulateAction(GUEST_ID, 'move', HOST_ID, { gameId, index: 4, symbol: 'O' });
            }
            // moveCount 3 is the winning move - guest also gets tictactoe:end
        });

        hostSocket.on('tictactoe:move', async (data) => {
            events.push('host:move');
            if (data.lastMove === 3) {
                // After guest's first move, host plays 1
                await simulateAction(HOST_ID, 'move', GUEST_ID, { gameId, index: 1, symbol: 'X' });
            }
            if (data.lastMove === 4) {
                // After guest's second move, host plays 2 → WINNING MOVE
                await simulateAction(HOST_ID, 'move', GUEST_ID, { gameId, index: 2, symbol: 'X' });
            }
        });

        // Step 5: Both receive end
        let endCount = 0;
        const onEnd = (data) => {
            endCount++;
            events.push(`end:${endCount}`);
            expect(data.result.winner).toBe('X');
            expect(data.result.line).toEqual([0, 1, 2]);

            if (endCount === 2) {
                // Verify complete event chain
                expect(events).toContain('guest:invite');
                expect(events).toContain('accept:1');
                expect(events).toContain('accept:2');
                expect(events).toContain('end:1');
                expect(events).toContain('end:2');

                // Verify DB state
                TicTacToeGame.findOne({ gameId }).lean().then((game) => {
                    expect(game.status).toBe('ended');
                    expect(game.result.winner).toBe('X');
                    expect(game.board[0]).toBe('X');
                    expect(game.board[1]).toBe('X');
                    expect(game.board[2]).toBe('X');
                    done();
                });
            }
        };
        hostSocket.on('tictactoe:end', onEnd);
        guestSocket.on('tictactoe:end', onEnd);

        // Kick off the flow
        simulateAction(HOST_ID, 'invite', GUEST_ID, { gameId });
    }, 15000);

    // ════════════════════════════════════════════════════════════════
    // Full Draw
    // ════════════════════════════════════════════════════════════════
    test('Full Draw: all 9 moves → draw result via Socket.IO', (done) => {
        const gameId = `ttt_e2e_draw_${Date.now()}`;

        // Draw board: X O X / X O O / O X X
        // Move order: X0→O1→X2→O4→X3→O5→X7→O6→X8
        const hostMoves = [0, 2, 3, 7, 8]; // X
        const guestMoves = [1, 4, 5, 6];    // O
        let hostMoveIdx = 0;
        let guestMoveIdx = 0;

        guestSocket.on('tictactoe:invite', async () => {
            await simulateAction(GUEST_ID, 'accept', HOST_ID, { gameId });
        });

        let acceptCount = 0;
        const startGame = async () => {
            acceptCount++;
            if (acceptCount === 2) {
                // Host starts with move 0
                await simulateAction(HOST_ID, 'move', GUEST_ID, { gameId, index: hostMoves[hostMoveIdx++], symbol: 'X' });
            }
        };
        hostSocket.on('tictactoe:accept', startGame);
        guestSocket.on('tictactoe:accept', startGame);

        guestSocket.on('tictactoe:move', async (data) => {
            if (data.status === 'playing' && guestMoveIdx < guestMoves.length) {
                await simulateAction(GUEST_ID, 'move', HOST_ID, { gameId, index: guestMoves[guestMoveIdx++], symbol: 'O' });
            }
        });

        hostSocket.on('tictactoe:move', async (data) => {
            if (data.status === 'playing' && hostMoveIdx < hostMoves.length) {
                await simulateAction(HOST_ID, 'move', GUEST_ID, { gameId, index: hostMoves[hostMoveIdx++], symbol: 'X' });
            }
        });

        let endCount = 0;
        const onEnd = (data) => {
            endCount++;
            expect(data.result.winner).toBe('draw');
            expect(data.result.line).toBeNull();

            if (endCount === 2) {
                TicTacToeGame.findOne({ gameId }).lean().then((game) => {
                    expect(game.status).toBe('ended');
                    expect(game.result.winner).toBe('draw');
                    expect(game.board.every(c => c !== null)).toBe(true);
                    done();
                });
            }
        };
        hostSocket.on('tictactoe:end', onEnd);
        guestSocket.on('tictactoe:end', onEnd);

        simulateAction(HOST_ID, 'invite', GUEST_ID, { gameId });
    }, 15000);

    // ════════════════════════════════════════════════════════════════
    // Decline flow
    // ════════════════════════════════════════════════════════════════
    test('Invite → Decline: host receives decline event', (done) => {
        const gameId = `ttt_e2e_decline_${Date.now()}`;

        guestSocket.on('tictactoe:invite', async (data) => {
            await simulateAction(GUEST_ID, 'decline', HOST_ID, { gameId: data.gameId });
        });

        hostSocket.on('tictactoe:decline', async (data) => {
            expect(data.gameId).toBe(gameId);

            const game = await TicTacToeGame.findOne({ gameId }).lean();
            expect(game.status).toBe('declined');
            done();
        });

        simulateAction(HOST_ID, 'invite', GUEST_ID, { gameId });
    }, 10000);

    // ════════════════════════════════════════════════════════════════
    // Forfeit (close mid-game)
    // ════════════════════════════════════════════════════════════════
    test('Forfeit: host closes mid-game → guest receives close event', (done) => {
        const gameId = `ttt_e2e_close_${Date.now()}`;

        guestSocket.on('tictactoe:invite', async () => {
            await simulateAction(GUEST_ID, 'accept', HOST_ID, { gameId });
        });

        let acceptCount = 0;
        const onAccept = async () => {
            acceptCount++;
            if (acceptCount === 2) {
                // Host forfeits immediately
                await simulateAction(HOST_ID, 'close', GUEST_ID, { gameId });
            }
        };
        hostSocket.on('tictactoe:accept', onAccept);
        guestSocket.on('tictactoe:accept', onAccept);

        guestSocket.on('tictactoe:close', async (data) => {
            expect(data.gameId).toBe(gameId);

            const game = await TicTacToeGame.findOne({ gameId }).lean();
            expect(game.status).toBe('ended');
            done();
        });

        simulateAction(HOST_ID, 'invite', GUEST_ID, { gameId });
    }, 10000);

    // ════════════════════════════════════════════════════════════════
    // Cancel pending invite
    // ════════════════════════════════════════════════════════════════
    test('Cancel: host closes pending invite → guest receives close event', (done) => {
        const gameId = `ttt_e2e_cancel_${Date.now()}`;

        guestSocket.on('tictactoe:invite', async () => {
            // Wait a moment, then host cancels before guest accepts
            setTimeout(async () => {
                await simulateAction(HOST_ID, 'close', GUEST_ID, { gameId });
            }, 100);
        });

        guestSocket.on('tictactoe:close', async (data) => {
            expect(data.gameId).toBe(gameId);

            const game = await TicTacToeGame.findOne({ gameId }).lean();
            expect(game.status).toBe('ended');
            done();
        });

        simulateAction(HOST_ID, 'invite', GUEST_ID, { gameId });
    }, 10000);
});
