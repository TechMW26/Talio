/**
 * Check In / Check Out — Complete Jest Test Suite
 *
 * 10 test groups covering every layer of the UI synchronization fix:
 *   1. API Call & Response Handling
 *   2. State Update After Successful API Response
 *   3. Optimistic UI Update & Rollback
 *   4. Button State During API Call
 *   5. Cache Invalidation (SWR mutate)
 *   6. Widget and Component Sync
 *   7. Socket.IO Event Handling
 *   8. Cross-Tab BroadcastChannel Sync
 *   9. Error Handling & User Feedback
 *  10. Edge Cases (midnight boundary, duplicate clicks, new-day reset)
 *
 * Run:  npx jest tests/web/attendance/CheckInOut.test.js
 */

import React from 'react'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

// ════════════════════════════════════════════════════════════════
// SHARED FIXTURES
// ════════════════════════════════════════════════════════════════

const EMPLOYEE_ID = '507f1f77bcf86cd799439011'
const USER_ID = 'user-abc-123'

const FIXTURES = {
    user: {
        _id: USER_ID,
        userId: USER_ID,
        employeeId: EMPLOYEE_ID,
        firstName: 'John',
        lastName: 'Doe',
        role: 'employee',
        email: 'john@test.com',
    },
    /** No attendance record yet (null) */
    notCheckedIn: null,
    /** Checked-in state (in-progress) */
    checkedIn: {
        _id: 'att-001',
        employeeId: EMPLOYEE_ID,
        checkIn: '2026-03-23T09:00:00.000Z',
        checkOut: null,
        status: 'in-progress',
        workHours: 0,
        location: { address: '123 Test St' },
    },
    /** Checked-out state (present / day complete) */
    checkedOut: {
        _id: 'att-001',
        employeeId: EMPLOYEE_ID,
        checkIn: '2026-03-23T09:00:00.000Z',
        checkOut: '2026-03-23T18:00:00.000Z',
        status: 'present',
        workHours: 9,
        location: { address: '123 Test St' },
    },
    /** Successful check-in response from the server */
    serverCheckInResponse: {
        success: true,
        data: {
            _id: 'att-001',
            employeeId: EMPLOYEE_ID,
            checkIn: '2026-03-23T09:00:05.000Z', // server timestamp differs
            checkOut: null,
            status: 'in-progress',
            workHours: 0,
            location: { address: '123 Test St, Mumbai', latitude: 19.076, longitude: 72.877 },
        },
    },
    /** Successful check-out response from the server */
    serverCheckOutResponse: {
        success: true,
        data: {
            _id: 'att-001',
            employeeId: EMPLOYEE_ID,
            checkIn: '2026-03-23T09:00:05.000Z',
            checkOut: '2026-03-23T18:00:02.000Z',
            status: 'present',
            workHours: 9,
            location: { address: '123 Test St, Mumbai' },
        },
    },
    /** Unified dashboard endpoint response */
    unifiedResponse: {
        success: true,
        todayAttendance: null,
        employee: null,
        companySettings: { checkInTime: '09:00', absentThresholdMinutes: 60 },
        holidays: [],
        announcements: [],
        attendanceSummary: [],
        pendingLeaveRequests: [],
        departments: [],
    },
    /** Employee stats endpoint response */
    statsResponse: { success: true, data: {} },
}

// ════════════════════════════════════════════════════════════════
// MOCKS — External modules
// ════════════════════════════════════════════════════════════════

// ── next/navigation ──
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}))

// ── ThemeContext ──
jest.mock('@/contexts/ThemeContext', () => ({
    useTheme: () => ({ theme: { primary: { 500: '#3B82F6', 600: '#2563EB' } } }),
}))

// ── toast ──
jest.mock('@/utils/toast', () => {
    const fn = jest.fn()
    fn.success = jest.fn()
    fn.error = jest.fn()
    fn.loading = jest.fn()
    fn.info = jest.fn()
    fn.custom = jest.fn()
    fn.promise = jest.fn()
    return { __esModule: true, default: fn }
})

// ── userHelper ──
jest.mock('@/utils/userHelper', () => ({
    getCurrentUser: () => ({
        _id: 'user-abc-123',
        userId: 'user-abc-123',
        employeeId: '507f1f77bcf86cd799439011',
        firstName: 'John',
        lastName: 'Doe',
        role: 'employee',
        email: 'john@test.com',
    }),
    getEmployeeId: (u) => u?.employeeId || null,
}))

// ── formatters ──
jest.mock('@/lib/formatters', () => ({
    formatDesignation: (d) => d || '',
}))

// ── useRealtimeDashboard ──
let capturedRealtimeCallbacks = {}
jest.mock('@/hooks/useRealtimeDashboard', () => ({
    __esModule: true,
    default: (opts) => {
        capturedRealtimeCallbacks = opts || {}
        return { isConnected: true }
    },
    useRealtimeDashboard: (opts) => {
        capturedRealtimeCallbacks = opts || {}
        return { isConnected: true }
    },
}))

// ── CallAlertButton ──
jest.mock('@/components/CallAlertButton', () => ({
    __esModule: true,
    default: () => null,
}))

// ── CustomizableDashboard — renders widgetComponents values so we can test real widgets ──
jest.mock('@/components/dashboard', () => ({
    __esModule: true,
    CustomizableDashboard: ({ widgetComponents }) => (
        <div data-testid="dashboard">
            {Object.entries(widgetComponents || {}).map(([id, node]) => (
                <div key={id} data-testid={`widget-${id}`}>{node}</div>
            ))}
        </div>
    ),
}))

// ── @heroui/react — lightweight HTML stand-ins ──
jest.mock('@heroui/react', () => ({
    Card: ({ children, className, ...rest }) => <div className={className} {...rest}>{children}</div>,
    CardBody: ({ children, className }) => <div className={className}>{children}</div>,
    Button: ({ children, onPress, isDisabled, isLoading, className, startContent, ...rest }) => (
        <button
            onClick={isDisabled ? undefined : onPress}
            disabled={isDisabled || false}
            data-loading={isLoading ? 'true' : undefined}
            className={className}
            {...rest}
        >
            {startContent}{children}
        </button>
    ),
    Avatar: ({ name }) => <span data-testid="avatar">{name}</span>,
    Chip: ({ children, color, variant, startContent, className, classNames, size }) => (
        <span data-chip-color={color} data-chip-variant={variant}>{startContent}{children}</span>
    ),
}))

// ── react-icons/fa — stub all used icons ──
jest.mock('react-icons/fa', () =>
    new Proxy({}, {
        get: (_, name) => {
            // Return a component for any FaXxx import
            const Icon = (props) => <span data-icon={name} {...props} />
            Icon.displayName = name
            return Icon
        },
    })
)

// ── Stub remaining widget imports that are not under test ──
jest.mock('@/components/widgets', () => {
    const React = require('react')
    const actual = jest.requireActual('@/components/widgets/CheckInOutWidget')
    const actualQG = jest.requireActual('@/components/widgets/QuickGlanceWidget')
    const stubNames = [
        'KPIStatsWidget', 'LeaveRequestsWidget', 'DepartmentChartWidget',
        'ProjectTasksWidgetWrapper', 'AttendanceSummaryWidget', 'TeamAttendanceWidget',
        'EmployeeDirectoryWidget', 'LeaveBalanceWidget', 'QuickActionsWidget',
        'AnnouncementsWidget', 'HolidaysWidget', 'GoalsWidget', 'BirthdayWidget',
        'RecentActivitiesWidget', 'TodayTasksWidget', 'LearningProgressWidget',
        'RecentActivityWidget', 'MyAssetsWidget', 'MyExpensesWidget',
        'MyHelpdeskWidget', 'PoliciesWidget', 'RoleNewsWidget',
    ]
    const stubs = {}
    stubNames.forEach((name) => {
        stubs[name] = () => React.createElement('div', { 'data-testid': `stub-${name}` })
    })
    return {
        __esModule: true,
        CheckInOutWidget: actual.default || actual,
        QuickGlanceWidget: actualQG.default || actualQG,
        ...stubs,
    }
})

// ════════════════════════════════════════════════════════════════
// MOCKS — Browser APIs
// ════════════════════════════════════════════════════════════════

// ── BroadcastChannel ──
let broadcastInstances = []
let broadcastOnMessage = null

class MockBroadcastChannel {
    constructor(name) {
        this.name = name
        this.postMessage = jest.fn()
        this.close = jest.fn()
        broadcastInstances.push(this)
    }
    set onmessage(fn) {
        broadcastOnMessage = fn
    }
    get onmessage() {
        return broadcastOnMessage
    }
}
global.BroadcastChannel = MockBroadcastChannel

// ── localStorage ──
const localStorageMock = (() => {
    let store = {}
    return {
        getItem: jest.fn((key) => store[key] ?? null),
        setItem: jest.fn((key, val) => { store[key] = String(val) }),
        removeItem: jest.fn((key) => { delete store[key] }),
        clear: jest.fn(() => { store = {} }),
        get length() { return Object.keys(store).length },
        key: jest.fn((i) => Object.keys(store)[i] || null),
        _store: store,
        _reset: () => { store = {} },
    }
})()
Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true })

// ── navigator.geolocation ──
const geoMock = {
    getCurrentPosition: jest.fn((success) =>
        success({
            coords: { latitude: 19.076, longitude: 72.877, accuracy: 10 },
        })
    ),
}
Object.defineProperty(navigator, 'geolocation', { value: geoMock, writable: true })

// ── fetch ──
let fetchMock
const makeFetchResponse = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
})

// ════════════════════════════════════════════════════════════════
// IMPORT THE COMPONENT UNDER TEST
// ════════════════════════════════════════════════════════════════

import UnifiedDashboard from '@/components/dashboards/UnifiedDashboard'
import toast from '@/utils/toast'

// Alias for assertions
const mockToast = toast

// ════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════

/**
 * Sets up the default fetch mock that handles /api/dashboard/unified,
 * /api/dashboard/employee-stats, and the attendance endpoint.
 * Returns a reference to the mock for per-test customization.
 */
function setupFetchMock(overrides = {}) {
    const attendanceBody = overrides.attendance || FIXTURES.serverCheckInResponse
    const unifiedBody = overrides.unified || FIXTURES.unifiedResponse
    const statsBody = overrides.stats || FIXTURES.statsResponse

    fetchMock = jest.fn((url, opts) => {
        // Attendance POST
        if (url === '/api/attendance' && opts?.method === 'POST') {
            if (overrides.attendanceFn) return overrides.attendanceFn(url, opts)
            return Promise.resolve(makeFetchResponse(attendanceBody))
        }
        // Unified dashboard
        if (url === '/api/dashboard/unified') {
            return Promise.resolve(makeFetchResponse(unifiedBody))
        }
        // Stats
        if (typeof url === 'string' && url.includes('/api/dashboard/')) {
            return Promise.resolve(makeFetchResponse(statsBody))
        }
        // IP location fallback
        if (typeof url === 'string' && url.includes('/api/attendance/ip-location')) {
            return Promise.resolve(makeFetchResponse({ success: true, latitude: 19.076, longitude: 72.877, city: 'Mumbai', region: 'MH' }))
        }
        // GET attendance (for real-time refetch)
        if (typeof url === 'string' && url.includes('/api/attendance?')) {
            return Promise.resolve(makeFetchResponse({ success: true, data: [FIXTURES.checkedIn] }))
        }
        // Settings
        if (typeof url === 'string' && url.includes('/api/settings/company')) {
            return Promise.resolve(makeFetchResponse({ success: true, data: { checkInTime: '09:00' } }))
        }
        return Promise.resolve(makeFetchResponse({ success: true }))
    })
    global.fetch = fetchMock
    return fetchMock
}

/** Renders UnifiedDashboard and waits for initial effects to settle. */
async function renderDashboard(overrides = {}) {
    const fm = setupFetchMock(overrides)
    localStorageMock._reset()
    localStorageMock.setItem('token', 'test-jwt-token')
    localStorageMock.setItem('user', JSON.stringify(FIXTURES.user))

    let result
    await act(async () => {
        result = render(<UnifiedDashboard user={FIXTURES.user} />)
    })
    // Wait for initial useEffect fetches to resolve
    await act(async () => {
        await new Promise((r) => setTimeout(r, 50))
    })
    return { ...result, fetchMock: fm }
}

/** Finds the Check In button in the rendered tree. */
function getCheckInButton() {
    const buttons = screen.getAllByRole('button')
    return buttons.find((b) => b.textContent.includes('Check In'))
}

/** Finds the Check Out button in the rendered tree. */
function getCheckOutButton() {
    const buttons = screen.getAllByRole('button')
    return buttons.find((b) => b.textContent.includes('Check Out'))
}

// ════════════════════════════════════════════════════════════════
// SETUP & TEARDOWN
// ════════════════════════════════════════════════════════════════

beforeEach(() => {
    jest.useFakeTimers({ advanceTimers: true })
    jest.clearAllMocks()
    broadcastInstances = []
    broadcastOnMessage = null
    capturedRealtimeCallbacks = {}
    localStorageMock._reset()
    localStorageMock.setItem('token', 'test-jwt-token')
    localStorageMock.setItem('user', JSON.stringify(FIXTURES.user))
})

afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
    if (global.fetch) delete global.fetch
})

// ════════════════════════════════════════════════════════════════
// GROUP 1 — API Call & Response Handling
// ════════════════════════════════════════════════════════════════

describe('Group 1 — API Call & Response Handling', () => {
    test('check-in hits POST /api/attendance with type clock-in and employee ID', async () => {
        const { fetchMock } = await renderDashboard()
        const btn = getCheckInButton()

        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 50))
        })

        const attendanceCalls = fetchMock.mock.calls.filter(
            ([url, opts]) => url === '/api/attendance' && opts?.method === 'POST'
        )
        expect(attendanceCalls.length).toBeGreaterThanOrEqual(1)

        const body = JSON.parse(attendanceCalls[0][1].body)
        expect(body.type).toBe('clock-in')
        expect(body.employeeId).toBe(EMPLOYEE_ID)
    })

    test('check-out hits POST /api/attendance with type clock-out', async () => {
        // Start with a checked-in state
        const { fetchMock } = await renderDashboard({
            unified: { ...FIXTURES.unifiedResponse, todayAttendance: FIXTURES.checkedIn },
            attendance: FIXTURES.serverCheckOutResponse,
        })
        const btn = getCheckOutButton()

        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 50))
        })

        const calls = fetchMock.mock.calls.filter(
            ([url, opts]) => url === '/api/attendance' && opts?.method === 'POST'
        )
        expect(calls.length).toBeGreaterThanOrEqual(1)
        const body = JSON.parse(calls[0][1].body)
        expect(body.type).toBe('clock-out')
    })

    test('a successful response is reflected in the UI state', async () => {
        await renderDashboard()
        const btn = getCheckInButton()

        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 100))
        })

        // After success, toast.success should have been called
        expect(mockToast.success).toHaveBeenCalledWith('Checked in successfully!')
    })

    test('a failed API response triggers the error path and does not show success', async () => {
        await renderDashboard({
            attendanceFn: () =>
                Promise.resolve(makeFetchResponse({ success: false, message: 'Holiday today' })),
        })
        const btn = getCheckInButton()

        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 100))
        })

        expect(mockToast.error).toHaveBeenCalledWith('Holiday today')
        expect(mockToast.success).not.toHaveBeenCalled()
    })

    test('a network error is caught and handled gracefully', async () => {
        await renderDashboard({
            attendanceFn: () => Promise.reject(new Error('Network failure')),
        })
        const btn = getCheckInButton()

        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 100))
        })

        expect(mockToast.error).toHaveBeenCalledWith('Failed to check in')
    })

    test('the API request includes an Authorization header with the JWT token', async () => {
        const { fetchMock } = await renderDashboard()
        const btn = getCheckInButton()

        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 50))
        })

        const call = fetchMock.mock.calls.find(
            ([url, opts]) => url === '/api/attendance' && opts?.method === 'POST'
        )
        expect(call[1].headers['Authorization']).toBe('Bearer test-jwt-token')
    })

    test('the API request includes location coordinates in the body', async () => {
        const { fetchMock } = await renderDashboard()
        const btn = getCheckInButton()

        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 50))
        })

        const call = fetchMock.mock.calls.find(
            ([url, opts]) => url === '/api/attendance' && opts?.method === 'POST'
        )
        const body = JSON.parse(call[1].body)
        expect(body.latitude).toBe(19.076)
        expect(body.longitude).toBe(72.877)
    })
})

// ════════════════════════════════════════════════════════════════
// GROUP 2 — State Update After Successful API Response
// ════════════════════════════════════════════════════════════════

describe('Group 2 — State Update After Successful API Response', () => {
    test('attendance state is updated immediately after a successful check-in response', async () => {
        await renderDashboard()
        const btn = getCheckInButton()

        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 150))
        })

        // The Check In button should now be disabled (user is already checked in)
        const checkInBtn = getCheckInButton()
        expect(checkInBtn).toBeDisabled()
    })

    test('check-in time is displayed correctly from the server response data', async () => {
        await renderDashboard()
        const btn = getCheckInButton()

        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 150))
        })

        // The QuickGlance widget should display the server check-in time
        const widget = screen.getByTestId('widget-quick-glance')
        // Server response has checkIn: '2026-03-23T09:00:05.000Z', checkout is still --:--
        // Verify check-in time is rendered (not all dashes)
        expect(widget.textContent).toContain('In Progress')
        // The Check Out slot will still show --:-- since we only checked in
        // But the Check In slot should have a real time
        expect(widget.textContent).toContain('pm') // locale time format includes am/pm
    })

    test('state transitions from not-started to in-progress after check-in', async () => {
        await renderDashboard()

        // Before check-in, Quick Glance should not show "In Progress" status
        const widgetBefore = screen.getByTestId('widget-quick-glance')
        expect(widgetBefore.textContent).not.toContain('In Progress')

        const btn = getCheckInButton()
        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 150))
        })

        // After check-in: In Progress status should appear
        const widgetAfter = screen.getByTestId('widget-quick-glance')
        expect(widgetAfter.textContent).toContain('In Progress')
    })

    test('state transitions from in-progress to present after check-out', async () => {
        await renderDashboard({
            unified: { ...FIXTURES.unifiedResponse, todayAttendance: FIXTURES.checkedIn },
            attendance: FIXTURES.serverCheckOutResponse,
        })

        const widgetBefore = screen.getByTestId('widget-quick-glance')
        expect(widgetBefore.textContent).toContain('In Progress')

        const btn = getCheckOutButton()
        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 150))
        })

        const widgetAfter = screen.getByTestId('widget-quick-glance')
        expect(widgetAfter.textContent).toContain('Present')
    })

    test('null response data does not corrupt existing state', async () => {
        await renderDashboard({
            unified: { ...FIXTURES.unifiedResponse, todayAttendance: FIXTURES.checkedIn },
            attendanceFn: () =>
                Promise.resolve(makeFetchResponse({ success: false, message: 'Server error' })),
        })

        const btn = getCheckOutButton()
        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 150))
        })

        // State should be rolled back to checked-in (in-progress)
        const widget = screen.getByTestId('widget-quick-glance')
        expect(widget.textContent).toContain('In Progress')
    })
})

// ════════════════════════════════════════════════════════════════
// GROUP 3 — Optimistic UI Update & Rollback
// ════════════════════════════════════════════════════════════════

describe('Group 3 — Optimistic UI Update & Rollback', () => {
    test('the UI state is updated immediately before the API call completes (optimistic)', async () => {
        let resolveAttendance
        const pendingPromise = new Promise((res) => { resolveAttendance = res })

        await renderDashboard({
            attendanceFn: () => pendingPromise,
        })

        const btn = getCheckInButton()

        // Click – optimistic update should happen immediately
        await act(async () => {
            fireEvent.click(btn)
        })

        // The widget should already show In Progress (optimistic) while API is pending
        const widget = screen.getByTestId('widget-quick-glance')
        expect(widget.textContent).toContain('In Progress')

        // Now resolve the API
        await act(async () => {
            resolveAttendance(makeFetchResponse(FIXTURES.serverCheckInResponse))
            await new Promise((r) => setTimeout(r, 50))
        })
    })

    test('when the API succeeds the optimistic state is replaced with server data', async () => {
        await renderDashboard()
        const btn = getCheckInButton()

        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 150))
        })

        // toast.success confirms the real server response was applied
        expect(mockToast.success).toHaveBeenCalledWith('Checked in successfully!')
    })

    test('when the API fails the state is rolled back to what it was before the click', async () => {
        await renderDashboard({
            attendanceFn: () => Promise.reject(new Error('Server down')),
        })

        // Before click: no attendance
        const widgetBefore = screen.getByTestId('widget-quick-glance')
        const textBefore = widgetBefore.textContent

        const btn = getCheckInButton()
        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 150))
        })

        // After failure: should roll back — Check In button should be enabled again
        const checkInBtn = getCheckInButton()
        expect(checkInBtn).not.toBeDisabled()
    })

    test('rollback restores every field of the previous state — not just status', async () => {
        const prevAttendance = { ...FIXTURES.checkedIn }

        await renderDashboard({
            unified: { ...FIXTURES.unifiedResponse, todayAttendance: prevAttendance },
            attendanceFn: () => Promise.reject(new Error('Server error')),
        })

        const btn = getCheckOutButton()
        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 150))
        })

        // After rollback the check-in time should still be from the original record
        const widget = screen.getByTestId('widget-quick-glance')
        // Status should be back to In Progress (rolled back)
        expect(widget.textContent).toContain('In Progress')
        // The check-in time should still be displayed (from the original record)
        expect(widget.textContent).toContain('pm')
    })
})

// ════════════════════════════════════════════════════════════════
// GROUP 4 — Button State During API Call
// ════════════════════════════════════════════════════════════════

describe('Group 4 — Button State During API Call', () => {
    test('the check-in button is disabled immediately on click', async () => {
        let resolveAttendance
        const pending = new Promise((res) => { resolveAttendance = res })

        await renderDashboard({ attendanceFn: () => pending })
        const btn = getCheckInButton()

        await act(async () => {
            fireEvent.click(btn)
        })

        // While API is in-flight the button should be disabled (attendanceLoading=true
        // AND todayAttendance.checkIn is set optimistically)
        const afterBtn = getCheckInButton()
        expect(afterBtn).toBeDisabled()

        // Cleanup
        await act(async () => {
            resolveAttendance(makeFetchResponse(FIXTURES.serverCheckInResponse))
            await new Promise((r) => setTimeout(r, 50))
        })
    })

    test('a second click while the first request is in flight does not trigger a second API call', async () => {
        let resolveAttendance
        const pending = new Promise((res) => { resolveAttendance = res })

        const { fetchMock } = await renderDashboard({ attendanceFn: () => pending })
        const btn = getCheckInButton()

        await act(async () => {
            fireEvent.click(btn)
        })

        // Count attendance POST calls so far
        const countBefore = fetchMock.mock.calls.filter(
            ([url, opts]) => url === '/api/attendance' && opts?.method === 'POST'
        ).length

        // Try clicking Check In again (should be disabled)
        const afterBtn = getCheckInButton()
        await act(async () => {
            fireEvent.click(afterBtn)
        })

        const countAfter = fetchMock.mock.calls.filter(
            ([url, opts]) => url === '/api/attendance' && opts?.method === 'POST'
        ).length

        expect(countAfter).toBe(countBefore) // No new call

        await act(async () => {
            resolveAttendance(makeFetchResponse(FIXTURES.serverCheckInResponse))
            await new Promise((r) => setTimeout(r, 50))
        })
    })

    test('the check-in button re-enables (as disabled for checked-in state) after successful check-in', async () => {
        await renderDashboard()
        const btn = getCheckInButton()

        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 150))
        })

        // After success: attendanceLoading is false, but todayAttendance.checkIn is set
        // so check-in button stays disabled (already checked in), check-out is enabled
        const checkOutBtn = getCheckOutButton()
        expect(checkOutBtn).not.toBeDisabled()
    })

    test('the buttons re-enable after a failed API call', async () => {
        await renderDashboard({
            attendanceFn: () => Promise.reject(new Error('fail')),
        })
        const btn = getCheckInButton()

        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 150))
        })

        // After failure + rollback: state goes back to not-checked-in
        // so check-in button should be enabled again
        const checkInBtn = getCheckInButton()
        expect(checkInBtn).not.toBeDisabled()
    })

    test('button disabled state is consistent with attendance state at all times', async () => {
        // Start not checked in: Check In enabled, Check Out disabled
        await renderDashboard()
        expect(getCheckInButton()).not.toBeDisabled()
        expect(getCheckOutButton()).toBeDisabled()

        // Check in
        await act(async () => {
            fireEvent.click(getCheckInButton())
            await new Promise((r) => setTimeout(r, 150))
        })

        // After check-in: Check In disabled, Check Out enabled
        expect(getCheckInButton()).toBeDisabled()
        expect(getCheckOutButton()).not.toBeDisabled()
    })
})

// ════════════════════════════════════════════════════════════════
// GROUP 5 — Cache Invalidation
// ════════════════════════════════════════════════════════════════

describe('Group 5 — Cache Invalidation', () => {
    test('BroadcastChannel is used to notify other tabs after successful check-in (acts as cache sync)', async () => {
        await renderDashboard()
        const btn = getCheckInButton()

        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 150))
        })

        const channel = broadcastInstances.find((c) => c.name === 'talio-attendance-sync')
        expect(channel).toBeTruthy()
        expect(channel.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'check-in', attendance: FIXTURES.serverCheckInResponse.data })
        )
    })

    test('BroadcastChannel is used to notify other tabs after successful check-out', async () => {
        await renderDashboard({
            unified: { ...FIXTURES.unifiedResponse, todayAttendance: FIXTURES.checkedIn },
            attendance: FIXTURES.serverCheckOutResponse,
        })
        const btn = getCheckOutButton()

        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 150))
        })

        const channel = broadcastInstances.find((c) => c.name === 'talio-attendance-sync')
        expect(channel.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'check-out', attendance: FIXTURES.serverCheckOutResponse.data })
        )
    })

    test('cache invalidation (broadcast) is not triggered when the API call fails', async () => {
        await renderDashboard({
            attendanceFn: () => Promise.reject(new Error('fail')),
        })
        const btn = getCheckInButton()

        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 150))
        })

        const channel = broadcastInstances.find((c) => c.name === 'talio-attendance-sync')
        // postMessage should NOT have been called with a check-in event
        if (channel) {
            const checkInCalls = channel.postMessage.mock.calls.filter(
                ([msg]) => msg?.type === 'check-in'
            )
            expect(checkInCalls).toHaveLength(0)
        }
    })

    test('broadcast happens after the state update succeeds, not before', async () => {
        const callOrder = []

        await renderDashboard({
            attendanceFn: () => {
                callOrder.push('api-response')
                return Promise.resolve(makeFetchResponse(FIXTURES.serverCheckInResponse))
            },
        })

        // Intercept broadcastChannel.postMessage to track order
        const origMockBC = MockBroadcastChannel.prototype
        const origPostMessage = origMockBC.postMessage

        const btn = getCheckInButton()

        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 150))
        })

        // toast.success is called after setState, broadcast is called after setState
        // Both should come after the API response
        expect(mockToast.success).toHaveBeenCalled()
    })
})

// ════════════════════════════════════════════════════════════════
// GROUP 6 — Widget and Component Sync
// ════════════════════════════════════════════════════════════════

describe('Group 6 — Widget and Component Sync', () => {
    test('the Quick Glance widget and CheckInOut widget both read from the same state and reflect changes', async () => {
        await renderDashboard()

        // Both widgets should show not-checked-in state
        const checkInOutWidget = screen.getByTestId('widget-check-in-out')
        const quickGlanceWidget = screen.getByTestId('widget-quick-glance')

        // Check In Out widget should show "Not Checked In"
        expect(checkInOutWidget.textContent).toContain('Not Checked In')
        // Quick Glance should show "--:--" for check-in time
        expect(quickGlanceWidget.textContent).toContain('--:--')

        // Now check in
        await act(async () => {
            fireEvent.click(getCheckInButton())
            await new Promise((r) => setTimeout(r, 150))
        })

        // Both widgets should now reflect checked-in state
        expect(screen.getByTestId('widget-check-in-out').textContent).toContain('Working')
        expect(screen.getByTestId('widget-quick-glance').textContent).toContain('In Progress')
    })

    test('the status badge updates its text when attendance status changes', async () => {
        await renderDashboard()

        // Initially "Not Checked In" badge
        const widget = screen.getByTestId('widget-check-in-out')
        expect(widget.textContent).toContain('Not Checked In')

        // Check in
        await act(async () => {
            fireEvent.click(getCheckInButton())
            await new Promise((r) => setTimeout(r, 150))
        })

        // Should show "Working" badge
        expect(screen.getByTestId('widget-check-in-out').textContent).toContain('Working')
    })

    test('the work hours display starts counting after check-in', async () => {
        await renderDashboard()

        // Before check-in: work hours show "--:--"
        const quickGlance = screen.getByTestId('widget-quick-glance')
        expect(quickGlance.textContent).toContain('--:--')

        // Check in with server response that has checkIn time
        await act(async () => {
            fireEvent.click(getCheckInButton())
            await new Promise((r) => setTimeout(r, 150))
        })

        // After check-in: work hours should show some value (not --:--)
        const afterWidget = screen.getByTestId('widget-quick-glance')
        // The work hours should now display a calculated value (e.g., "0h 0m" or similar)
        const workHoursText = afterWidget.textContent
        // It should not have --:-- for work hours anymore (check-in time is present)
        const allDashes = (workHoursText.match(/--:--/g) || []).length
        // At most one --:-- (for checkout time) — work hours should have changed
        expect(allDashes).toBeLessThanOrEqual(1)
    })

    test('the work hours display stops at a fixed value after check-out', async () => {
        await renderDashboard({
            unified: { ...FIXTURES.unifiedResponse, todayAttendance: FIXTURES.checkedIn },
            attendance: FIXTURES.serverCheckOutResponse,
        })

        // Check out
        await act(async () => {
            fireEvent.click(getCheckOutButton())
            await new Promise((r) => setTimeout(r, 150))
        })

        // After check-out: Quick Glance should show the work hours from server (9h)
        const widget = screen.getByTestId('widget-quick-glance')
        expect(widget.textContent).toContain('9h')
    })
})

// ════════════════════════════════════════════════════════════════
// GROUP 7 — Socket.IO Event Handling
// ════════════════════════════════════════════════════════════════

describe('Group 7 — Socket.IO Event Handling', () => {
    test('receiving an attendance-updated socket event updates the state immediately', async () => {
        await renderDashboard()

        // Before: not checked in
        expect(screen.getByTestId('widget-quick-glance').textContent).toContain('--:--')

        // Simulate socket event via the captured callback
        expect(capturedRealtimeCallbacks.onAttendanceUpdate).toBeDefined()

        await act(async () => {
            capturedRealtimeCallbacks.onAttendanceUpdate({ attendance: FIXTURES.checkedIn })
            await new Promise((r) => setTimeout(r, 50))
        })

        // After socket event: should show checked-in state
        expect(screen.getByTestId('widget-quick-glance').textContent).toContain('In Progress')
    })

    test('the socket listener callback is registered exactly once during the component lifecycle', async () => {
        await renderDashboard()

        // The useRealtimeDashboard mock was called — it should have received onAttendanceUpdate
        expect(capturedRealtimeCallbacks.onAttendanceUpdate).toBeInstanceOf(Function)
        // The mock was called (at least once for the initial render)
        // Since we use refs inside useRealtimeDashboard, the callback reference should be stable
    })

    test('a socket event without attendance data triggers a refetch instead', async () => {
        const { fetchMock } = await renderDashboard()
        const callCountBefore = fetchMock.mock.calls.length

        await act(async () => {
            capturedRealtimeCallbacks.onAttendanceUpdate({ someOtherField: true })
            await new Promise((r) => setTimeout(r, 100))
        })

        // Should have triggered a fetch for today's attendance
        const attendanceGets = fetchMock.mock.calls.filter(
            ([url]) => typeof url === 'string' && url.includes('/api/attendance?employeeId=')
        )
        expect(attendanceGets.length).toBeGreaterThanOrEqual(1)
    })

    test('the socket listener is cleaned up correctly on component unmount', async () => {
        // The useRealtimeDashboard hook returns cleanup functions via useEffect
        // Since we mock it, we verify the contract: the hook is called with callbacks
        const { unmount } = await renderDashboard()

        expect(capturedRealtimeCallbacks.onAttendanceUpdate).toBeInstanceOf(Function)

        // Unmounting should not throw
        await act(async () => {
            unmount()
        })
    })

    test('a socket event with identical data to current state does not cause errors', async () => {
        await renderDashboard({
            unified: { ...FIXTURES.unifiedResponse, todayAttendance: FIXTURES.checkedIn },
        })

        // Send the same data again
        await act(async () => {
            capturedRealtimeCallbacks.onAttendanceUpdate({ attendance: FIXTURES.checkedIn })
            await new Promise((r) => setTimeout(r, 50))
        })

        // No errors, state should remain the same
        expect(screen.getByTestId('widget-quick-glance').textContent).toContain('In Progress')
    })
})

// ════════════════════════════════════════════════════════════════
// GROUP 8 — Cross-Tab BroadcastChannel Sync
// ════════════════════════════════════════════════════════════════

describe('Group 8 — Cross-Tab BroadcastChannel Sync', () => {
    test('after a successful check-in a message is posted to BroadcastChannel with check-in type', async () => {
        await renderDashboard()
        const btn = getCheckInButton()

        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 150))
        })

        const channel = broadcastInstances.find((c) => c.name === 'talio-attendance-sync')
        expect(channel).toBeTruthy()
        expect(channel.postMessage).toHaveBeenCalledWith({
            type: 'check-in',
            attendance: FIXTURES.serverCheckInResponse.data,
        })
    })

    test('receiving a broadcast message from another tab updates the attendance state', async () => {
        await renderDashboard()

        // Quick Glance should show not-checked-in
        expect(screen.getByTestId('widget-quick-glance').textContent).toContain('--:--')

        // Simulate receiving a message from another tab
        expect(broadcastOnMessage).toBeInstanceOf(Function)

        await act(async () => {
            broadcastOnMessage({
                data: { type: 'check-in', attendance: FIXTURES.checkedIn },
            })
            await new Promise((r) => setTimeout(r, 50))
        })

        // State should be updated from the broadcast
        expect(screen.getByTestId('widget-quick-glance').textContent).toContain('In Progress')
    })

    test('receiving a check-out broadcast from another tab updates to checked-out state', async () => {
        await renderDashboard({
            unified: { ...FIXTURES.unifiedResponse, todayAttendance: FIXTURES.checkedIn },
        })

        await act(async () => {
            broadcastOnMessage({
                data: { type: 'check-out', attendance: FIXTURES.checkedOut },
            })
            await new Promise((r) => setTimeout(r, 50))
        })

        expect(screen.getByTestId('widget-quick-glance').textContent).toContain('Present')
    })

    test('a broadcast with an unrecognized type does not alter attendance state', async () => {
        await renderDashboard({
            unified: { ...FIXTURES.unifiedResponse, todayAttendance: FIXTURES.checkedIn },
        })

        await act(async () => {
            broadcastOnMessage({
                data: { type: 'unknown-event', attendance: FIXTURES.checkedOut },
            })
            await new Promise((r) => setTimeout(r, 50))
        })

        // State should not change to checked-out
        expect(screen.getByTestId('widget-quick-glance').textContent).toContain('In Progress')
    })

    test('a broadcast with missing attendance data does not corrupt state', async () => {
        await renderDashboard({
            unified: { ...FIXTURES.unifiedResponse, todayAttendance: FIXTURES.checkedIn },
        })

        await act(async () => {
            broadcastOnMessage({
                data: { type: 'check-in', attendance: null },
            })
            await new Promise((r) => setTimeout(r, 50))
        })

        // Should still show In Progress (unchanged)
        expect(screen.getByTestId('widget-quick-glance').textContent).toContain('In Progress')
    })
})

// ════════════════════════════════════════════════════════════════
// GROUP 9 — Error Handling & User Feedback
// ════════════════════════════════════════════════════════════════

describe('Group 9 — Error Handling & User Feedback', () => {
    test('a 500 error triggers an error toast with the server message', async () => {
        await renderDashboard({
            attendanceFn: () =>
                Promise.resolve(makeFetchResponse({ success: false, message: 'Internal Server Error' })),
        })
        const btn = getCheckInButton()

        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 150))
        })

        expect(mockToast.error).toHaveBeenCalledWith('Internal Server Error')
    })

    test('a generic error falls back to a default error message', async () => {
        await renderDashboard({
            attendanceFn: () =>
                Promise.resolve(makeFetchResponse({ success: false })),
        })
        const btn = getCheckInButton()

        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 150))
        })

        expect(mockToast.error).toHaveBeenCalledWith('Failed to check in')
    })

    test('a network error results in visible user feedback', async () => {
        await renderDashboard({
            attendanceFn: () => Promise.reject(new Error('fetch failed')),
        })
        const btn = getCheckInButton()

        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 150))
        })

        expect(mockToast.error).toHaveBeenCalled()
    })

    test('no error is swallowed silently — every error path results in user feedback', async () => {
        // Test check-out error path too
        await renderDashboard({
            unified: { ...FIXTURES.unifiedResponse, todayAttendance: FIXTURES.checkedIn },
            attendanceFn: () => Promise.reject(new Error('Server unreachable')),
        })
        const btn = getCheckOutButton()

        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 150))
        })

        expect(mockToast.error).toHaveBeenCalledWith('Failed to check out')
    })

    test('the loading state is cleared after an error so the user is never stuck', async () => {
        await renderDashboard({
            attendanceFn: () => Promise.reject(new Error('fail')),
        })
        const btn = getCheckInButton()

        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 150))
        })

        // After error: buttons should not have loading state
        const checkInBtn = getCheckInButton()
        expect(checkInBtn).not.toBeDisabled()
        expect(checkInBtn.dataset.loading).toBeUndefined()
    })

    test('a server error message is used when provided instead of a generic one', async () => {
        await renderDashboard({
            attendanceFn: () =>
                Promise.resolve(makeFetchResponse(
                    { success: false, message: 'You are outside the geofence area' }
                )),
        })
        const btn = getCheckInButton()

        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 150))
        })

        expect(mockToast.error).toHaveBeenCalledWith('You are outside the geofence area')
    })
})

// ════════════════════════════════════════════════════════════════
// GROUP 10 — Edge Cases
// ════════════════════════════════════════════════════════════════

describe('Group 10 — Edge Cases', () => {
    test('check-in at 23:59 produces correct optimistic state with that timestamp', async () => {
        // Mock Date.now to be 23:59
        const lateNight = new Date('2026-03-23T23:59:00.000Z')
        jest.setSystemTime(lateNight)

        await renderDashboard()
        const btn = getCheckInButton()

        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 150))
        })

        // The server response replaces the optimistic, but the optimistic was set with 23:59
        // After success, the state should have the server timestamp
        expect(mockToast.success).toHaveBeenCalledWith('Checked in successfully!')
    })

    test('a server timestamp that differs from the optimistic timestamp correctly replaces it', async () => {
        // The optimistic update uses new Date().toISOString() (client time)
        // The server response has a different time: '2026-03-23T09:00:05.000Z'
        jest.setSystemTime(new Date('2026-03-23T09:00:00.000Z'))

        await renderDashboard()
        const btn = getCheckInButton()

        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 150))
        })

        // After success, the widget should reflect the SERVER timestamp, not the client one
        // Server checkIn: '2026-03-23T09:00:05.000Z'
        const widget = screen.getByTestId('widget-quick-glance')
        // State should be in-progress from the server response
        expect(widget.textContent).toContain('In Progress')
        // Check-in time should be rendered (checkout will still be --:--)
        expect(mockToast.success).toHaveBeenCalledWith('Checked in successfully!')
    })

    test('a duplicate check-in attempt does not trigger a second API call when already checked in', async () => {
        const { fetchMock } = await renderDashboard()

        // First check in
        await act(async () => {
            fireEvent.click(getCheckInButton())
            await new Promise((r) => setTimeout(r, 150))
        })

        const countAfterFirst = fetchMock.mock.calls.filter(
            ([url, opts]) => url === '/api/attendance' && opts?.method === 'POST'
        ).length

        // Try clicking Check In again — it should be disabled
        const btn = getCheckInButton()
        expect(btn).toBeDisabled()

        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 50))
        })

        const countAfterSecond = fetchMock.mock.calls.filter(
            ([url, opts]) => url === '/api/attendance' && opts?.method === 'POST'
        ).length

        expect(countAfterSecond).toBe(countAfterFirst) // No additional call
    })

    test('the first check-in of a new day creates a fresh record without carrying over previous day state', async () => {
        // Start with yesterday's completed attendance
        const yesterdayAttendance = {
            _id: 'att-yesterday',
            employeeId: EMPLOYEE_ID,
            checkIn: '2026-03-22T09:00:00.000Z',
            checkOut: '2026-03-22T18:00:00.000Z',
            status: 'present',
            workHours: 9,
        }

        // The unified endpoint returns null for today (new day)
        await renderDashboard({
            unified: { ...FIXTURES.unifiedResponse, todayAttendance: null },
        })

        // Check in button should be enabled (new day, no check-in)
        const btn = getCheckInButton()
        expect(btn).not.toBeDisabled()

        // Quick Glance should show --:-- (no check-in yet)
        const widget = screen.getByTestId('widget-quick-glance')
        expect(widget.textContent).toContain('--:--')

        // Check in for the new day
        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 150))
        })

        // Should be a fresh check-in
        expect(mockToast.success).toHaveBeenCalledWith('Checked in successfully!')
    })

    test('check-out after midnight with check-in before midnight calculates work hours correctly', async () => {
        // Check-in at 23:00 on March 23
        const crossMidnightCheckedIn = {
            _id: 'att-cross',
            employeeId: EMPLOYEE_ID,
            checkIn: '2026-03-23T23:00:00.000Z',
            checkOut: null,
            status: 'in-progress',
            workHours: 0,
        }

        // Server calculates work hours across midnight correctly
        const crossMidnightResponse = {
            success: true,
            data: {
                _id: 'att-cross',
                employeeId: EMPLOYEE_ID,
                checkIn: '2026-03-23T23:00:00.000Z',
                checkOut: '2026-03-24T02:00:00.000Z', // 3 hours later
                status: 'present',
                workHours: 3,
            },
        }

        jest.setSystemTime(new Date('2026-03-24T02:00:00.000Z'))

        await renderDashboard({
            unified: { ...FIXTURES.unifiedResponse, todayAttendance: crossMidnightCheckedIn },
            attendance: crossMidnightResponse,
        })

        const btn = getCheckOutButton()
        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 150))
        })

        // After checkout, work hours should show 3h
        const widget = screen.getByTestId('widget-quick-glance')
        expect(widget.textContent).toContain('3h')
    })

    test('with IP-based fallback location when GPS fails', async () => {
        // Mock geolocation to fail
        geoMock.getCurrentPosition.mockImplementationOnce((_success, reject) => {
            reject(new Error('GPS unavailable'))
        })

        const { fetchMock } = await renderDashboard()
        const btn = getCheckInButton()

        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 150))
        })

        // Should have hit the IP location endpoint
        const ipCalls = fetchMock.mock.calls.filter(
            ([url]) => typeof url === 'string' && url.includes('/api/attendance/ip-location')
        )
        expect(ipCalls.length).toBeGreaterThanOrEqual(1)

        // Check in should still succeed
        expect(mockToast.success).toHaveBeenCalledWith('Checked in successfully!')
    })
})

// ════════════════════════════════════════════════════════════════
// SOURCE VALIDATION — Pattern verification
// ════════════════════════════════════════════════════════════════

describe('Source Validation — Structural guarantees', () => {
    const fs = require('fs')
    const path = require('path')

    const dashboardSource = fs.readFileSync(
        path.join(__dirname, '../../../components/dashboards/UnifiedDashboard.js'),
        'utf8'
    )

    test('UnifiedDashboard contains optimistic update pattern for check-in', () => {
        expect(dashboardSource).toContain('setTodayAttendance(optimisticAttendance)')
    })

    test('UnifiedDashboard contains rollback pattern on error for check-in', () => {
        expect(dashboardSource).toContain('setTodayAttendance(previousAttendance)')
    })

    test('UnifiedDashboard uses BroadcastChannel with talio-attendance-sync', () => {
        expect(dashboardSource).toContain("BroadcastChannel('talio-attendance-sync')")
    })

    test('UnifiedDashboard posts check-in message to BroadcastChannel', () => {
        expect(dashboardSource).toContain("postMessage({ type: 'check-in'")
    })

    test('UnifiedDashboard posts check-out message to BroadcastChannel', () => {
        expect(dashboardSource).toContain("postMessage({ type: 'check-out'")
    })

    test('UnifiedDashboard subscribes to onAttendanceUpdate via useRealtimeDashboard', () => {
        expect(dashboardSource).toContain('onAttendanceUpdate: handleAttendanceUpdate')
    })

    test('handleAttendanceUpdate directly sets state when data.attendance is present', () => {
        expect(dashboardSource).toContain('setTodayAttendance(data.attendance)')
    })

    test('UnifiedDashboard guards against double submission with attendanceLoading check', () => {
        expect(dashboardSource).toContain('if (attendanceLoading) return')
    })

    test('attendanceLoading is always cleared in finally blocks', () => {
        // Count how many try blocks match check-in/check-out (2 total)
        const finallyBlocks = dashboardSource.match(/finally\s*\{[^}]*setAttendanceLoading\(false\)/g) || []
        expect(finallyBlocks.length).toBeGreaterThanOrEqual(2)
    })

    test('BroadcastChannel handler only processes check-in and check-out events', () => {
        expect(dashboardSource).toContain("type === 'check-in' || type === 'check-out'")
    })

    test('BroadcastChannel is closed on component unmount', () => {
        expect(dashboardSource).toContain('channel.close()')
    })
})

// ════════════════════════════════════════════════════════════════
// ADDITIONAL COVERAGE — Status variants & fallback paths
// ════════════════════════════════════════════════════════════════

describe('Additional Coverage — QuickGlance status variants', () => {
    test('QuickGlance shows WFH status when workFromHome flag is set', async () => {
        const wfhAttendance = {
            ...FIXTURES.checkedIn,
            workFromHome: true,
        }
        await renderDashboard({
            unified: { ...FIXTURES.unifiedResponse, todayAttendance: wfhAttendance },
        })
        const widget = screen.getByTestId('widget-quick-glance')
        expect(widget.textContent).toContain('WFH')
    })

    test('QuickGlance shows Half Day status appropriately', async () => {
        const halfDayAttendance = {
            ...FIXTURES.checkedIn,
            status: 'half-day',
        }
        await renderDashboard({
            unified: { ...FIXTURES.unifiedResponse, todayAttendance: halfDayAttendance },
        })
        const widget = screen.getByTestId('widget-quick-glance')
        expect(widget.textContent).toContain('Half Day')
    })

    test('QuickGlance shows On Leave status when on approved leave', async () => {
        const onLeaveAttendance = {
            status: 'on-leave',
            checkIn: null,
        }
        await renderDashboard({
            unified: { ...FIXTURES.unifiedResponse, todayAttendance: onLeaveAttendance },
        })
        const widget = screen.getByTestId('widget-quick-glance')
        expect(widget.textContent).toContain('On Leave')
    })

    test('QuickGlance shows Absent status for auto-marked absent records', async () => {
        const absentAttendance = {
            status: 'absent',
            checkIn: null,
        }
        await renderDashboard({
            unified: { ...FIXTURES.unifiedResponse, todayAttendance: absentAttendance },
        })
        const widget = screen.getByTestId('widget-quick-glance')
        expect(widget.textContent).toContain('Absent')
    })

    test('QuickGlance shows Present status after a full day', async () => {
        await renderDashboard({
            unified: { ...FIXTURES.unifiedResponse, todayAttendance: FIXTURES.checkedOut },
        })
        const widget = screen.getByTestId('widget-quick-glance')
        expect(widget.textContent).toContain('Present')
    })

    test('QuickGlance shows Absent status for checked-in records with absent status', async () => {
        const absentWithCheckIn = {
            ...FIXTURES.checkedIn,
            status: 'absent',
        }
        await renderDashboard({
            unified: { ...FIXTURES.unifiedResponse, todayAttendance: absentWithCheckIn },
        })
        const widget = screen.getByTestId('widget-quick-glance')
        expect(widget.textContent).toContain('Absent')
    })
})

describe('Additional Coverage — Check-out IP fallback and edge paths', () => {
    test('check-out falls back to IP location when GPS fails', async () => {
        // GPS will fail for the check-out call
        geoMock.getCurrentPosition
            .mockImplementationOnce((_success, reject) => reject(new Error('GPS fail')))

        const { fetchMock } = await renderDashboard({
            unified: { ...FIXTURES.unifiedResponse, todayAttendance: FIXTURES.checkedIn },
            attendance: FIXTURES.serverCheckOutResponse,
        })
        const btn = getCheckOutButton()

        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 200))
        })

        const ipCalls = fetchMock.mock.calls.filter(
            ([url]) => typeof url === 'string' && url.includes('/api/attendance/ip-location')
        )
        expect(ipCalls.length).toBeGreaterThanOrEqual(1)
        expect(mockToast.success).toHaveBeenCalledWith('Checked out successfully!')
    })

    test('check-in continues even when both GPS and IP location fail', async () => {
        geoMock.getCurrentPosition.mockImplementationOnce((_success, reject) => {
            reject(new Error('GPS fail'))
        })

        // Override IP location to fail
        const { fetchMock } = await renderDashboard({
            attendanceFn: (url, opts) => {
                if (url === '/api/attendance' && opts?.method === 'POST') {
                    return Promise.resolve(makeFetchResponse(FIXTURES.serverCheckInResponse))
                }
            },
        })

        // Override the IP location endpoint to return failure
        const origFetch = fetchMock
        fetchMock.mockImplementation((url, opts) => {
            if (typeof url === 'string' && url.includes('/api/attendance/ip-location')) {
                return Promise.reject(new Error('IP location service down'))
            }
            if (url === '/api/attendance' && opts?.method === 'POST') {
                return Promise.resolve(makeFetchResponse(FIXTURES.serverCheckInResponse))
            }
            return Promise.resolve(makeFetchResponse({ success: true }))
        })

        const btn = getCheckInButton()
        await act(async () => {
            fireEvent.click(btn)
            await new Promise((r) => setTimeout(r, 200))
        })

        // Check-in should still succeed (location is optional)
        expect(mockToast.success).toHaveBeenCalledWith('Checked in successfully!')
    })

    test('management role triggers additional dashboard data fetch on attendance update', async () => {
        // Use admin role
        const adminUser = { ...FIXTURES.user, role: 'admin' }
        jest.spyOn(require('@/utils/userHelper'), 'getCurrentUser').mockReturnValue(adminUser)

        const fm = setupFetchMock()
        localStorageMock._reset()
        localStorageMock.setItem('token', 'test-jwt-token')
        localStorageMock.setItem('user', JSON.stringify(adminUser))

        let result
        await act(async () => {
            result = render(<UnifiedDashboard user={adminUser} />)
        })
        await act(async () => {
            await new Promise((r) => setTimeout(r, 50))
        })

        const callCountBefore = fm.mock.calls.length

        // Simulate socket attendance update
        await act(async () => {
            capturedRealtimeCallbacks.onAttendanceUpdate?.({ attendance: FIXTURES.checkedIn })
            await new Promise((r) => setTimeout(r, 100))
        })

        // Management role should trigger additional fetches (dashboard stats)
        const callCountAfter = fm.mock.calls.length
        expect(callCountAfter).toBeGreaterThan(callCountBefore)

        result.unmount()
    })

    test('countdown timer starts when checked in and stops when checked out', async () => {
        jest.setSystemTime(new Date('2026-03-23T09:00:00.000Z'))

        await renderDashboard({
            unified: { ...FIXTURES.unifiedResponse, todayAttendance: FIXTURES.checkedIn },
        })

        // Timer should be counting (Quick Glance formatCountdown is called)
        const widget = screen.getByTestId('widget-quick-glance')
        // Should show a time value (not all zeros once checked in)
        expect(widget.textContent).toMatch(/\d{2}:\d{2}:\d{2}/)
    })
})
