/**
 * Web TicTacToeContext Tests
 *
 * Source code validation + zero-polling enforcement.
 * Verifies the web context has been fully migrated from polling
 * to Socket.IO events.
 *
 * CRITICAL TESTS:
 * - Zero setInterval calls (polling fully eliminated)
 * - Zero pollGameState references (renamed to fetchGameState)
 * - All 6 Socket.IO event handlers registered + cleaned up
 * - Reconnection handler present
 */

const fs = require('fs');
const path = require('path');

const WEB_CONTEXT_PATH = path.join(__dirname, '../../contexts/TicTacToeContext.js');

let source;
let nonCommentLines; // Lines that are NOT pure comments

beforeAll(() => {
    source = fs.readFileSync(WEB_CONTEXT_PATH, 'utf8');
    nonCommentLines = source.split('\n').filter(line => {
        const trimmed = line.trim();
        return !trimmed.startsWith('//') && !trimmed.startsWith('*') && trimmed !== '';
    });
});

// ════════════════════════════════════════════════════════════════
// CRITICAL: Zero Polling Enforcement
// ════════════════════════════════════════════════════════════════
describe('CRITICAL - Zero Polling Enforcement (Web)', () => {
    test('source code contains zero setInterval calls', () => {
        const setIntervalUsages = nonCommentLines.filter(line =>
            line.includes('setInterval')
        );
        expect(setIntervalUsages).toHaveLength(0);
    });

    test('no pollGameState references remain in code', () => {
        const pollLines = nonCommentLines.filter(line =>
            line.includes('pollGameState')
        );
        expect(pollLines).toHaveLength(0);
    });

    test('uses fetchGameState (one-shot) instead of pollGameState', () => {
        expect(source).toContain('fetchGameState');
        expect(source).not.toContain('const pollGameState');
    });

    test('no recurring polling intervals (1500ms or 5000ms) exist', () => {
        const intervalLines = nonCommentLines.filter(line =>
            (line.includes('1500') || line.includes('5000')) && line.includes('setInterval')
        );
        expect(intervalLines).toHaveLength(0);
    });
});

// ════════════════════════════════════════════════════════════════
// Socket.IO Event Listeners
// ════════════════════════════════════════════════════════════════
describe('Socket.IO Event Registration (Web)', () => {
    test('registers all 6 Socket.IO event listeners', () => {
        const expectedEvents = [
            'tictactoe:invite',
            'tictactoe:accept',
            'tictactoe:decline',
            'tictactoe:move',
            'tictactoe:end',
            'tictactoe:close',
        ];

        for (const event of expectedEvents) {
            expect(source).toContain(`socket.on('${event}'`);
        }
    });

    test('cleans up all 6 event listeners on unmount', () => {
        const expectedEvents = [
            'tictactoe:invite',
            'tictactoe:accept',
            'tictactoe:decline',
            'tictactoe:move',
            'tictactoe:end',
            'tictactoe:close',
        ];

        for (const event of expectedEvents) {
            expect(source).toContain(`socket.off('${event}'`);
        }
    });

    test('imports useSocket from SocketContext', () => {
        expect(source).toContain("import { useSocket } from '@/contexts/SocketContext'");
    });

    test('destructures socket and isConnected from useSocket', () => {
        expect(source).toContain('useSocket()');
    });
});

// ════════════════════════════════════════════════════════════════
// Event Handler Logic
// ════════════════════════════════════════════════════════════════
describe('Event Handler Logic (Web)', () => {
    test('handleInvite checks phase is closed before processing', () => {
        expect(source).toContain("phaseRef.current !== 'closed'");
    });

    test('handlers validate gameId via gameIdRef', () => {
        const gameIdChecks = (source.match(/gameIdRef\.current/g) || []).length;
        // accept, decline, move, end, close = at least 5 checks + ref sync
        expect(gameIdChecks).toBeGreaterThanOrEqual(5);
    });

    test('handleMove clears the move safety net timeout', () => {
        expect(source).toContain('clearTimeout(moveTimeoutRef.current)');
    });

    test('all 6 named handler functions exist', () => {
        const handlers = [
            'handleInvite', 'handleAccept', 'handleDecline',
            'handleMove', 'handleEnd', 'handleClose',
        ];
        for (const handler of handlers) {
            expect(source).toContain(`const ${handler}`);
        }
    });
});

// ════════════════════════════════════════════════════════════════
// Safety Net & Reconnection
// ════════════════════════════════════════════════════════════════
describe('Safety Net & Reconnection (Web)', () => {
    test('has a 4-second move acknowledgement timeout', () => {
        expect(source).toContain('4000');
        expect(source).toContain('Move ack timeout');
    });

    test('has a socket reconnect handler', () => {
        expect(source).toContain("socket.on('reconnect'");
        expect(source).toContain("socket.off('reconnect'");
    });

    test('reconnect handler calls fetchGameState', () => {
        const reconnectIdx = source.indexOf("'reconnect'");
        const reconnectSection = source.substring(reconnectIdx, reconnectIdx + 300);
        expect(reconnectSection).toContain('fetchGameState');
    });
});

// ════════════════════════════════════════════════════════════════
// State Machine
// ════════════════════════════════════════════════════════════════
describe('State Machine (Web)', () => {
    test('defines all 5 game phases', () => {
        const phases = ['closed', 'invite-incoming', 'waiting', 'playing', 'result'];
        for (const phase of phases) {
            expect(source).toContain(`'${phase}'`);
        }
    });

    test('uses refs for stable callbacks (phaseRef, gameIdRef, mySymbolRef)', () => {
        expect(source).toContain('phaseRef');
        expect(source).toContain('gameIdRef');
        expect(source).toContain('mySymbolRef');
    });

    test('exports openInvite and hasIncomingInvite via context', () => {
        expect(source).toContain('openInvite');
        expect(source).toContain('hasIncomingInvite');
    });
});

// ════════════════════════════════════════════════════════════════
// Win effects (web-specific)
// ════════════════════════════════════════════════════════════════
describe('Win Effects (Web)', () => {
    test('triggers confetti on win', () => {
        expect(source).toContain('fireCrackers');
        expect(source).toContain('confetti');
    });

    test('plays audio on game events', () => {
        expect(source).toContain('playGameInviteSound');
        expect(source).toContain('playSuccessSound');
        expect(source).toContain('playGameOverSound');
    });
});
