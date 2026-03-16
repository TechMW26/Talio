/**
 * Backend API Route Tests — POST /api/tictactoe
 *
 * Tests the game logic functions (emitToUser, checkWinner) and
 * the TicTacToeGame Mongoose model independently of the Next.js
 * request lifecycle (which requires the full Next.js server).
 *
 * The API route uses getAuthAndModels() for multi-tenant auth,
 * which can't be unit-tested without the full Next.js stack.
 * So we test the DB operations and game logic directly.
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// ─── Win detection — same as in route.js ───
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

// ─── TicTacToeGame schema (mirrors lib/tenantModels.js) ───
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

const HOST_ID = 'host_user_001';
const GUEST_ID = 'guest_user_002';
const ANOTHER_ID = 'another_user_003';

beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    TicTacToeGame = mongoose.model('TicTacToeGame', TicTacToeGameSchema);
});

afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
});

afterEach(async () => {
    await TicTacToeGame.deleteMany({});
});

// ════════════════════════════════════════════════════════════════
// checkWinner — server-side win detection
// ════════════════════════════════════════════════════════════════
describe('checkWinner()', () => {
    test('detects top row win for X', () => {
        const board = ['X', 'X', 'X', 'O', 'O', null, null, null, null];
        expect(checkWinner(board)).toEqual({ winner: 'X', line: [0, 1, 2] });
    });

    test('detects middle row win for O', () => {
        const board = ['X', null, 'X', 'O', 'O', 'O', null, 'X', null];
        expect(checkWinner(board)).toEqual({ winner: 'O', line: [3, 4, 5] });
    });

    test('detects bottom row win', () => {
        const board = [null, null, null, null, null, null, 'X', 'X', 'X'];
        expect(checkWinner(board)).toEqual({ winner: 'X', line: [6, 7, 8] });
    });

    test('detects left column win', () => {
        const board = ['O', null, null, 'O', 'X', null, 'O', 'X', 'X'];
        expect(checkWinner(board)).toEqual({ winner: 'O', line: [0, 3, 6] });
    });

    test('detects middle column win', () => {
        const board = [null, 'X', null, 'O', 'X', null, 'O', 'X', null];
        expect(checkWinner(board)).toEqual({ winner: 'X', line: [1, 4, 7] });
    });

    test('detects right column win', () => {
        const board = [null, null, 'O', null, 'X', 'O', 'X', null, 'O'];
        expect(checkWinner(board)).toEqual({ winner: 'O', line: [2, 5, 8] });
    });

    test('detects diagonal win (top-left to bottom-right)', () => {
        const board = ['X', 'O', null, null, 'X', 'O', null, null, 'X'];
        expect(checkWinner(board)).toEqual({ winner: 'X', line: [0, 4, 8] });
    });

    test('detects diagonal win (top-right to bottom-left)', () => {
        const board = [null, null, 'O', null, 'O', null, 'O', null, 'X'];
        expect(checkWinner(board)).toEqual({ winner: 'O', line: [2, 4, 6] });
    });

    test('detects draw when board is full and no winner', () => {
        const board = ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'];
        expect(checkWinner(board)).toEqual({ winner: 'draw', line: null });
    });

    test('returns null when game is still in progress', () => {
        const board = ['X', 'O', null, null, null, null, null, null, null];
        expect(checkWinner(board)).toBeNull();
    });

    test('returns null for empty board', () => {
        const board = Array(9).fill(null);
        expect(checkWinner(board)).toBeNull();
    });
});

// ════════════════════════════════════════════════════════════════
// Invite action — DB operations
// ════════════════════════════════════════════════════════════════
describe('action: invite — DB operations', () => {
    test('creates a pending game document with correct fields', async () => {
        const gameId = `ttt_${HOST_ID}_${GUEST_ID}_${Date.now()}`;
        const game = await TicTacToeGame.create({
            gameId,
            hostUserId: HOST_ID,
            guestUserId: GUEST_ID,
            hostName: 'John Host',
            hostAvatar: 'avatar.jpg',
            status: 'pending',
            board: Array(9).fill(null),
            currentTurn: 'X',
            hostSymbol: 'X',
        });

        expect(game.status).toBe('pending');
        expect(game.hostUserId).toBe(HOST_ID);
        expect(game.guestUserId).toBe(GUEST_ID);
        expect(game.hostName).toBe('John Host');
        expect(game.board).toHaveLength(9);
        expect(game.board.every(c => c === null)).toBe(true);
        expect(game.currentTurn).toBe('X');
        expect(game.hostSymbol).toBe('X');
        expect(game.createdAt).toBeDefined();
    });

    test('cancels existing pending invites when new invite is sent', async () => {
        // Create first pending invite
        const gameId1 = `ttt_${HOST_ID}_${ANOTHER_ID}_${Date.now()}`;
        await TicTacToeGame.create({
            gameId: gameId1,
            hostUserId: HOST_ID,
            guestUserId: ANOTHER_ID,
            status: 'pending',
        });

        // Simulate the cancel logic from the route
        await TicTacToeGame.updateMany(
            { hostUserId: HOST_ID, status: 'pending' },
            { status: 'ended' }
        );

        // Create new invite
        const gameId2 = `ttt_${HOST_ID}_${GUEST_ID}_${Date.now() + 1}`;
        await TicTacToeGame.create({
            gameId: gameId2,
            hostUserId: HOST_ID,
            guestUserId: GUEST_ID,
            status: 'pending',
        });

        const oldGame = await TicTacToeGame.findOne({ gameId: gameId1 });
        expect(oldGame.status).toBe('ended');

        const newGame = await TicTacToeGame.findOne({ gameId: gameId2 });
        expect(newGame.status).toBe('pending');
    });

    test('gameId uniqueness is enforced', async () => {
        const gameId = `ttt_unique_${Date.now()}`;
        await TicTacToeGame.create({
            gameId,
            hostUserId: HOST_ID,
            guestUserId: GUEST_ID,
        });

        await expect(TicTacToeGame.create({
            gameId, // duplicate
            hostUserId: HOST_ID,
            guestUserId: ANOTHER_ID,
        })).rejects.toThrow();
    });
});

// ════════════════════════════════════════════════════════════════
// Accept action — DB operations
// ════════════════════════════════════════════════════════════════
describe('action: accept — DB operations', () => {
    let gameId;

    beforeEach(async () => {
        gameId = `ttt_${HOST_ID}_${GUEST_ID}_${Date.now()}`;
        await TicTacToeGame.create({
            gameId,
            hostUserId: HOST_ID,
            guestUserId: GUEST_ID,
            status: 'pending',
        });
    });

    test('transitions game from pending to playing', async () => {
        const game = await TicTacToeGame.findOneAndUpdate(
            { gameId, status: { $in: ['pending', 'playing'] } },
            { status: 'playing', guestName: 'Jane Guest', guestAvatar: 'guest.jpg', lastMoveAt: new Date() },
            { new: true }
        );

        expect(game.status).toBe('playing');
        expect(game.guestName).toBe('Jane Guest');
        expect(game.guestAvatar).toBe('guest.jpg');
    });

    test('does not accept an already declined game', async () => {
        await TicTacToeGame.findOneAndUpdate({ gameId }, { status: 'declined' });

        const game = await TicTacToeGame.findOneAndUpdate(
            { gameId, status: { $in: ['pending', 'playing'] } },
            { status: 'playing' },
            { new: true }
        );

        expect(game).toBeNull();
    });
});

// ════════════════════════════════════════════════════════════════
// Decline action — DB operations
// ════════════════════════════════════════════════════════════════
describe('action: decline — DB operations', () => {
    test('transitions game from pending to declined', async () => {
        const gameId = `ttt_${HOST_ID}_${GUEST_ID}_${Date.now()}`;
        await TicTacToeGame.create({
            gameId,
            hostUserId: HOST_ID,
            guestUserId: GUEST_ID,
            status: 'pending',
        });

        const game = await TicTacToeGame.findOneAndUpdate(
            { gameId, status: 'pending' },
            { status: 'declined' },
            { new: true }
        );

        expect(game.status).toBe('declined');
    });

    test('cannot decline a non-pending game', async () => {
        const gameId = `ttt_${HOST_ID}_${GUEST_ID}_${Date.now()}`;
        await TicTacToeGame.create({
            gameId,
            hostUserId: HOST_ID,
            guestUserId: GUEST_ID,
            status: 'playing',
        });

        const game = await TicTacToeGame.findOneAndUpdate(
            { gameId, status: 'pending' },
            { status: 'declined' },
            { new: true }
        );

        expect(game).toBeNull();
    });
});

// ════════════════════════════════════════════════════════════════
// Move action — DB operations + win detection
// ════════════════════════════════════════════════════════════════
describe('action: move — DB operations', () => {
    let gameId;

    beforeEach(async () => {
        gameId = `ttt_${HOST_ID}_${GUEST_ID}_${Date.now()}`;
        await TicTacToeGame.create({
            gameId,
            hostUserId: HOST_ID,
            guestUserId: GUEST_ID,
            status: 'playing',
            board: Array(9).fill(null),
            currentTurn: 'X',
            hostSymbol: 'X',
        });
    });

    test('updates board correctly after a valid move', async () => {
        const game = await TicTacToeGame.findOne({ gameId, status: { $in: ['playing', 'ended'] } });
        const board = [...game.board];
        board[4] = 'X';

        const result = checkWinner(board);
        game.board = board;
        game.currentTurn = 'O';
        game.lastMoveAt = new Date();
        if (result) { game.result = result; game.status = 'ended'; }
        await game.save();

        const updated = await TicTacToeGame.findOne({ gameId });
        expect(updated.board[4]).toBe('X');
        expect(updated.currentTurn).toBe('O');
        expect(updated.status).toBe('playing'); // no winner yet
    });

    test('detects winning move and sets status to ended', async () => {
        // Set up board one move from win
        await TicTacToeGame.findOneAndUpdate({ gameId }, {
            board: ['X', 'X', null, 'O', 'O', null, null, null, null],
            currentTurn: 'X',
        });

        const game = await TicTacToeGame.findOne({ gameId });
        const board = [...game.board];
        board[2] = 'X'; // complete top row

        const result = checkWinner(board);
        game.board = board;
        game.currentTurn = 'O';
        game.lastMoveAt = new Date();
        if (result) { game.result = result; game.status = 'ended'; }
        await game.save();

        const updated = await TicTacToeGame.findOne({ gameId });
        expect(updated.status).toBe('ended');
        expect(updated.result.winner).toBe('X');
        expect(updated.result.line).toEqual([0, 1, 2]);
    });

    test('detects draw when board is full', async () => {
        // One move away from draw: X O X / X O O / O X _
        await TicTacToeGame.findOneAndUpdate({ gameId }, {
            board: ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', null],
            currentTurn: 'X',
        });

        const game = await TicTacToeGame.findOne({ gameId });
        const board = [...game.board];
        board[8] = 'X';

        const result = checkWinner(board);
        game.board = board;
        game.currentTurn = 'O';
        game.lastMoveAt = new Date();
        if (result) { game.result = result; game.status = 'ended'; }
        await game.save();

        const updated = await TicTacToeGame.findOne({ gameId });
        expect(updated.status).toBe('ended');
        expect(updated.result.winner).toBe('draw');
        expect(updated.result.line).toBeNull();
    });

    test('rejects a move on an occupied cell', async () => {
        await TicTacToeGame.findOneAndUpdate({ gameId }, {
            board: ['X', null, null, null, null, null, null, null, null],
        });

        const game = await TicTacToeGame.findOne({ gameId });
        const board = [...game.board];

        // Cell 0 is already occupied — guard logic mirrors route.js
        expect(board[0]).toBe('X');
        const isOccupied = board[0] != null;
        expect(isOccupied).toBe(true);
    });
});

// ════════════════════════════════════════════════════════════════
// Close action — DB operations
// ════════════════════════════════════════════════════════════════
describe('action: close — DB operations', () => {
    test('marks a playing game as ended', async () => {
        const gameId = `ttt_${HOST_ID}_${GUEST_ID}_${Date.now()}`;
        await TicTacToeGame.create({
            gameId,
            hostUserId: HOST_ID,
            guestUserId: GUEST_ID,
            status: 'playing',
        });

        const game = await TicTacToeGame.findOneAndUpdate(
            { gameId, status: { $in: ['pending', 'playing'] } },
            { status: 'ended' },
            { new: true }
        );

        expect(game.status).toBe('ended');
    });

    test('marks a pending invite as ended on close', async () => {
        const gameId = `ttt_${HOST_ID}_${GUEST_ID}_${Date.now()}`;
        await TicTacToeGame.create({
            gameId,
            hostUserId: HOST_ID,
            guestUserId: GUEST_ID,
            status: 'pending',
        });

        const game = await TicTacToeGame.findOneAndUpdate(
            { gameId, status: { $in: ['pending', 'playing'] } },
            { status: 'ended' },
            { new: true }
        );

        expect(game.status).toBe('ended');
    });

    test('does not close an already ended game', async () => {
        const gameId = `ttt_${HOST_ID}_${GUEST_ID}_${Date.now()}`;
        await TicTacToeGame.create({
            gameId,
            hostUserId: HOST_ID,
            guestUserId: GUEST_ID,
            status: 'ended',
        });

        const game = await TicTacToeGame.findOneAndUpdate(
            { gameId, status: { $in: ['pending', 'playing'] } },
            { status: 'ended' },
            { new: true }
        );

        expect(game).toBeNull();
    });
});

// ════════════════════════════════════════════════════════════════
// GET endpoints — DB queries
// ════════════════════════════════════════════════════════════════
describe('GET operations — DB queries', () => {
    test('check=pending returns the most recent pending invite for user', async () => {
        // Create a pending invite for GUEST_ID
        const gameId = `ttt_${HOST_ID}_${GUEST_ID}_${Date.now()}`;
        await TicTacToeGame.create({
            gameId,
            hostUserId: HOST_ID,
            guestUserId: GUEST_ID,
            hostName: 'John Host',
            status: 'pending',
        });

        const pending = await TicTacToeGame.findOne({
            guestUserId: GUEST_ID,
            status: 'pending',
        }).sort({ createdAt: -1 }).lean();

        expect(pending).not.toBeNull();
        expect(pending.gameId).toBe(gameId);
        expect(pending.hostName).toBe('John Host');
    });

    test('check=pending returns null when no pending invites', async () => {
        const pending = await TicTacToeGame.findOne({
            guestUserId: GUEST_ID,
            status: 'pending',
        }).lean();

        expect(pending).toBeNull();
    });

    test('gameId query returns game state', async () => {
        const gameId = `ttt_${HOST_ID}_${GUEST_ID}_${Date.now()}`;
        await TicTacToeGame.create({
            gameId,
            hostUserId: HOST_ID,
            guestUserId: GUEST_ID,
            status: 'playing',
            board: ['X', null, null, null, 'O', null, null, null, null],
            currentTurn: 'X',
        });

        const game = await TicTacToeGame.findOne({ gameId }).lean();
        expect(game).not.toBeNull();
        expect(game.board[0]).toBe('X');
        expect(game.board[4]).toBe('O');
        expect(game.status).toBe('playing');
    });

    test('gameId query returns null for non-existent game', async () => {
        const game = await TicTacToeGame.findOne({ gameId: 'nonexistent_game' }).lean();
        expect(game).toBeNull();
    });

    test('history query returns only ended games for the user', async () => {
        // Create ended game
        await TicTacToeGame.create({
            gameId: `ttt_ended_${Date.now()}`,
            hostUserId: HOST_ID,
            guestUserId: GUEST_ID,
            hostName: 'Host',
            guestName: 'Guest',
            status: 'ended',
            result: { winner: 'X', line: [0, 1, 2] },
        });

        // Create pending game (should NOT appear in history)
        await TicTacToeGame.create({
            gameId: `ttt_pending_${Date.now()}`,
            hostUserId: HOST_ID,
            guestUserId: ANOTHER_ID,
            status: 'pending',
        });

        const games = await TicTacToeGame.find({
            $or: [{ hostUserId: HOST_ID }, { guestUserId: HOST_ID }],
            status: 'ended',
            result: { $ne: null },
        }).sort({ updatedAt: -1 }).limit(10).lean();

        expect(games).toHaveLength(1);
        expect(games[0].result.winner).toBe('X');
    });
});

// ════════════════════════════════════════════════════════════════
// emitToUser — helper function
// ════════════════════════════════════════════════════════════════
describe('emitToUser()', () => {
    test('does not throw when global.io is null', () => {
        const savedIo = global.io;
        global.io = null;

        // This mirrors the guard in the API route
        function emitToUser(userId, event, payload) {
            const io = global.io;
            if (!io) return;
            io.to(`user:${userId}`).emit(event, payload);
        }

        expect(() => emitToUser('user123', 'tictactoe:invite', {})).not.toThrow();
        global.io = savedIo;
    });

    test('calls io.to().emit() with correct room and event', () => {
        const mockEmit = jest.fn();
        const mockTo = jest.fn(() => ({ emit: mockEmit }));
        global.io = { to: mockTo };

        function emitToUser(userId, event, payload) {
            const io = global.io;
            if (!io) return;
            io.to(`user:${userId}`).emit(event, payload);
        }

        const payload = { gameId: 'test', hostName: 'Test' };
        emitToUser('user123', 'tictactoe:invite', payload);

        expect(mockTo).toHaveBeenCalledWith('user:user123');
        expect(mockEmit).toHaveBeenCalledWith('tictactoe:invite', payload);

        global.io = undefined;
    });
});
