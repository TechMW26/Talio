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
            setupFilesAfterEnv: ['<rootDir>/tests/setup.web.js'],
            moduleNameMapper: {
                '^@/(.*)$': '<rootDir>/$1',
            },
            transform: {
                '^.+\\.(js|jsx)$': ['@swc/jest', {
                    jsc: {
                        parser: { syntax: 'ecmascript', jsx: true },
                        transform: { react: { runtime: 'automatic' } },
                    },
                }],
            },
            transformIgnorePatterns: [
                '/node_modules/(?!(@heroui|swr|react-hot-toast)/)',
            ],
        },
    ],
    collectCoverageFrom: [
        'app/api/tictactoe/**/*.js',
        'contexts/TicTacToeContext.js',
        'components/dashboards/UnifiedDashboard.js',
        'components/widgets/CheckInOutWidget.js',
        'components/widgets/QuickGlanceWidget.js',
        'hooks/useRealtimeDashboard.js',
        'hooks/useApiMutation.js',
        'contexts/SocketContext.js',
    ],
    coverageThreshold: {
        global: {
            branches: 80,
            functions: 80,
            lines: 80,
        },
    },
};
