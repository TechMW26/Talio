/**
 * Mobile TicTacToeContext Tests
 *
 * CRITICAL zero-polling tests + source code structure validation.
 * These tests verify the mobile context has been fully migrated
 * from polling to Socket.IO without actually requiring React Native.
 */

const fs = require('fs');
const path = require('path');

const MOBILE_CONTEXT_PATH = path.resolve(
    __dirname,
    '../../../../talioapp/contexts/TicTacToeContext.tsx'
);

const mobileContextAvailable = fs.existsSync(MOBILE_CONTEXT_PATH);
let source;

if (mobileContextAvailable) {
    source = fs.readFileSync(MOBILE_CONTEXT_PATH, 'utf8');
} else {
    // eslint-disable-next-line no-console
    console.warn(
        `[SKIP] Mobile TicTacToeContext source not found at ${MOBILE_CONTEXT_PATH}. ` +
        'Ensure the talioapp repo is checked out as a sibling directory.'
    );
}

const suiteRunner = mobileContextAvailable ? describe : describe.skip;

suiteRunner('TicTacToeContext - Mobile: Source Code Validation', () => {

    // ════════════════════════════════════════════════════════════════
    // CRITICAL: Zero Polling
    // ════════════════════════════════════════════════════════════════
    test('CRITICAL: source code contains zero setInterval calls', () => {
        const lines = source.split('\n');
        const setIntervalLines = lines.filter(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('*')) return false;
            return trimmed.includes('setInterval');
        });

        expect(setIntervalLines).toHaveLength(0);
    });

    test('CRITICAL: no pollGameState references remain in code', () => {
        const lines = source.split('\n');
        const pollLines = lines.filter(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('*')) return false;
            return trimmed.includes('pollGameState');
        });

        expect(pollLines).toHaveLength(0);
    });

    // ════════════════════════════════════════════════════════════════
    // Socket.IO event listeners
    // ════════════════════════════════════════════════════════════════
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
            expect(source).toContain(`socket.off('${event}'`);
        }
    });

    test('all event handlers validate gameId via gameIdRef', () => {
        // The handlers for accept, decline, move, end, close should check gameIdRef
        const handlerNames = ['handleAccept', 'handleDecline', 'handleMove', 'handleEnd', 'handleClose'];
        for (const handler of handlerNames) {
            expect(source).toContain(handler);
        }

        // Count gameIdRef.current checks (should exist for accept, decline, move, end, close)
        const gameIdRefChecks = (source.match(/gameIdRef\.current/g) || []).length;
        expect(gameIdRefChecks).toBeGreaterThanOrEqual(5);
    });

    test('handleInvite checks phase is closed before processing', () => {
        expect(source).toContain("phaseRef.current !== 'closed'");
    });

    test('handleMove clears the safety net timeout', () => {
        // The handleMove handler should clear the move ack timeout
        expect(source).toContain('moveTimeoutRef.current');
        expect(source).toContain('clearTimeout(moveTimeoutRef.current)');
    });

    // ════════════════════════════════════════════════════════════════
    // Safety net & reconnection
    // ════════════════════════════════════════════════════════════════
    test('uses fetchGameState (one-shot) instead of pollGameState', () => {
        expect(source).toContain('fetchGameState');
        // Not as a polling function name
        expect(source).not.toContain('const pollGameState');
    });

    test('has a 4-second move acknowledgement timeout', () => {
        expect(source).toContain('4000');
        expect(source).toContain('Move ack timeout');
    });

    test('has a socket reconnect handler', () => {
        expect(source).toContain("socket.on('reconnect'");
        expect(source).toContain("socket.off('reconnect'");
    });

    test('reconnect handler fetches game state or checks pending invite', () => {
        // On reconnect, should call fetchGameState if active game, or checkPendingInvite if idle
        expect(source).toContain('fetchGameState');
        expect(source).toContain('checkPendingInvite');
    });

    // ════════════════════════════════════════════════════════════════
    // Foreground resume
    // ════════════════════════════════════════════════════════════════
    test('has AppState change listener for foreground resume', () => {
        expect(source).toContain("AppState.addEventListener('change'");
        expect(source).toContain("nextAppState === 'active'");
    });

    test('foreground resume calls fetchGameState (not polling)', () => {
        // The handleAppStateChange should call fetchGameState, not start an interval
        const appStateSection = source.substring(
            source.indexOf('handleAppStateChange'),
            source.indexOf('handleAppStateChange') + 500
        );
        expect(appStateSection).toContain('fetchGameState');
        expect(appStateSection).not.toContain('setInterval');
    });

    // ════════════════════════════════════════════════════════════════
    // Context exports
    // ════════════════════════════════════════════════════════════════
    test('exports useSocket import from SocketContext', () => {
        expect(source).toContain("import { useSocket } from './SocketContext'");
    });

    test('derives connectionStatus from socketConnected', () => {
        expect(source).toContain("socketConnected ? 'connected' : 'disconnected'");
    });

    test('exposes all required context values', () => {
        const requiredValues = [
            'phase', 'board', 'mySymbol', 'isMyTurn', 'result',
            'gameId', 'opponent', 'hasIncomingInvite', 'connectionStatus',
            'openInvite', 'acceptInvite', 'declineInvite', 'makeMove',
            'closeGame', 'rematch', 'handleInviteFromNotification',
        ];

        for (const value of requiredValues) {
            expect(source).toContain(value);
        }
    });

    // ════════════════════════════════════════════════════════════════
    // State machine phases
    // ════════════════════════════════════════════════════════════════
    test('defines all 5 game phases', () => {
        const phases = ['closed', 'invite-incoming', 'waiting', 'playing', 'result'];
        for (const phase of phases) {
            expect(source).toContain(`'${phase}'`);
        }
    });

    test('uses Haptics for game feedback', () => {
        expect(source).toContain('Haptics.notificationAsync');
        expect(source).toContain('Haptics.impactAsync');
        expect(source).toContain('NotificationFeedbackType.Warning');
        expect(source).toContain('NotificationFeedbackType.Success');
        expect(source).toContain('NotificationFeedbackType.Error');
    });

    // ════════════════════════════════════════════════════════════════
    // Header documentation
    // ════════════════════════════════════════════════════════════════
    test('header comment reflects Socket.IO architecture', () => {
        const headerEnd = source.indexOf('*/');
        const header = source.substring(0, headerEnd);

        expect(header).toContain('Socket.IO');
        expect(header).not.toContain('polling');
        expect(header).not.toContain('No external real-time dependencies');
    });
});
