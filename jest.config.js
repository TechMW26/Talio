module.exports = {
    projects: [
        // ── Node tests (API routes, Socket.IO, E2E, mobile source validation) ──
        {
            displayName: 'server',
            testEnvironment: 'node',
            testMatch: [
                '<rootDir>/tests/api/**/*.test.js',
                '<rootDir>/tests/socket/**/*.test.js',
                '<rootDir>/tests/e2e/**/*.test.js',
                '<rootDir>/tests/mobile/**/*.test.js',
            ],
            setupFilesAfterEnv: [],
        },
        // ── jsdom tests (Web React context) ──
        {
            displayName: 'web',
            testEnvironment: 'jsdom',
            testMatch: ['<rootDir>/tests/web/**/*.test.js'],
            setupFilesAfterEnv: [],
            moduleNameMapper: {
                '^@/(.*)$': '<rootDir>/$1',
            },
        },
    ],
    collectCoverageFrom: [
        'app/api/tictactoe/**/*.js',
        'contexts/TicTacToeContext.js',
    ],
    coverageThreshold: {
        global: {
            branches: 80,
            functions: 80,
            lines: 80,
        },
    },
};
