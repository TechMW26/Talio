'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import toast from '@/utils/toast'

const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'events', label: 'Events' },
    { id: 'blocked', label: 'Blocked IPs' },
]

const EVENT_TYPE_LABELS = {
    'auth.login.failed': { label: 'Failed login', tone: 'amber' },
    'auth.login.success': { label: 'Login success', tone: 'green' },
    'auth.login.locked': { label: 'Account locked', tone: 'red' },
    'auth.login.unlocked': { label: 'Account unlocked', tone: 'gray' },
    'rate_limit.hit': { label: 'Rate limit hit', tone: 'amber' },
    'ip.blocked': { label: 'IP blocked', tone: 'red' },
    'ip.unblocked': { label: 'IP unblocked', tone: 'gray' },
    'input.suspicious': { label: 'Suspicious input', tone: 'red' },
    'audit.superadmin.action': { label: 'Superadmin action', tone: 'blue' },
    'audit.admin.action': { label: 'Admin action', tone: 'blue' },
    'permission.denied': { label: 'Permission denied', tone: 'red' },
    'csrf.violation': { label: 'CSRF violation', tone: 'red' },
    'webhook.invalid_signature': { label: 'Bad webhook signature', tone: 'red' },
    'auth.token.invalid': { label: 'Invalid token', tone: 'amber' },
    'auth.token.expired': { label: 'Expired token', tone: 'gray' },
    'auth.session.revoked': { label: 'Session revoked', tone: 'gray' },
    'auth.password.reset_requested': { label: 'Reset requested', tone: 'blue' },
    'auth.password.reset_completed': { label: 'Reset completed', tone: 'green' },
    'desktop.token.suspicious': { label: 'Desktop token anomaly', tone: 'amber' },
}

const TONE_CLASSES = {
    green: 'bg-green-100 text-green-700',
    blue: 'bg-blue-100 text-blue-700',
    amber: 'bg-amber-100 text-amber-700',
    red: 'bg-red-100 text-red-700',
    gray: 'bg-gray-100 text-gray-700',
}

const SEVERITY_TONE = { info: 'gray', low: 'blue', medium: 'amber', high: 'red', critical: 'red' }

function authHeaders() {
    if (typeof window === 'undefined') return {}
    const token = localStorage.getItem('superadmin_token')
    return token ? { Authorization: `Bearer ${token}` } : {}
}

function StatCard({ title, value, hint, tone = 'blue' }) {
    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{title}</p>
            <p className={`mt-2 text-3xl font-bold ${tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : tone === 'green' ? 'text-green-600' : 'text-indigo-600'}`}>{value ?? '—'}</p>
            {hint ? <p className="mt-1 text-xs text-gray-400">{hint}</p> : null}
        </div>
    )
}

function Pill({ tone = 'gray', children }) {
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${TONE_CLASSES[tone] || TONE_CLASSES.gray}`}>
            {children}
        </span>
    )
}

function formatTime(iso) {
    if (!iso) return '—'
    try {
        const d = new Date(iso)
        return d.toLocaleString()
    } catch { return iso }
}

export default function SuperAdminSecurityPage() {
    const [activeTab, setActiveTab] = useState('overview')
    const [stats, setStats] = useState(null)
    const [statsLoading, setStatsLoading] = useState(true)
    const [events, setEvents] = useState([])
    const [eventsLoading, setEventsLoading] = useState(false)
    const [eventTotal, setEventTotal] = useState(0)
    const [eventFilters, setEventFilters] = useState({ type: '', severity: '', ip: '', email: '', sinceHours: 24 })
    const [blocks, setBlocks] = useState([])
    const [blocksLoading, setBlocksLoading] = useState(false)
    const [blockForm, setBlockForm] = useState({ ip: '', reason: '', durationHours: 24 })

    const loadStats = useCallback(async () => {
        setStatsLoading(true)
        try {
            const res = await fetch('/api/superadmin/security/stats', { headers: authHeaders() })
            const data = await res.json()
            if (!data.success) throw new Error(data.message || 'Failed')
            setStats(data)
        } catch (err) { toast.error(err.message || 'Failed to load stats') } finally { setStatsLoading(false) }
    }, [])

    const loadEvents = useCallback(async () => {
        setEventsLoading(true)
        try {
            const params = new URLSearchParams()
            if (eventFilters.type) params.set('type', eventFilters.type)
            if (eventFilters.severity) params.set('severity', eventFilters.severity)
            if (eventFilters.ip) params.set('ip', eventFilters.ip)
            if (eventFilters.email) params.set('email', eventFilters.email)
            const since = new Date(Date.now() - (Number(eventFilters.sinceHours) || 24) * 60 * 60_000).toISOString()
            params.set('since', since)
            params.set('limit', '100')
            const res = await fetch(`/api/superadmin/security/events?${params.toString()}`, { headers: authHeaders() })
            const data = await res.json()
            if (!data.success) throw new Error(data.message || 'Failed')
            setEvents(data.events || [])
            setEventTotal(data.total || 0)
        } catch (err) { toast.error(err.message || 'Failed to load events') } finally { setEventsLoading(false) }
    }, [eventFilters])

    const loadBlocks = useCallback(async () => {
        setBlocksLoading(true)
        try {
            const res = await fetch('/api/superadmin/security/blocked-ips', { headers: authHeaders() })
            const data = await res.json()
            if (!data.success) throw new Error(data.message || 'Failed')
            setBlocks(data.blocks || [])
        } catch (err) { toast.error(err.message || 'Failed to load blocks') } finally { setBlocksLoading(false) }
    }, [])

    useEffect(() => { loadStats() }, [loadStats])
    useEffect(() => { if (activeTab === 'events') loadEvents() }, [activeTab, loadEvents])
    useEffect(() => { if (activeTab === 'blocked') loadBlocks() }, [activeTab, loadBlocks])

    async function submitBlock(e) {
        e.preventDefault()
        if (!blockForm.ip.trim()) { toast.error('IP is required'); return }
        try {
            const durationMs = Number(blockForm.durationHours) > 0 ? Number(blockForm.durationHours) * 60 * 60_000 : null
            const res = await fetch('/api/superadmin/security/blocked-ips', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({ ip: blockForm.ip.trim(), reason: blockForm.reason, durationMs }),
            })
            const data = await res.json()
            if (!data.success) throw new Error(data.message || 'Failed')
            toast.success(`Blocked ${blockForm.ip}`)
            setBlockForm({ ip: '', reason: '', durationHours: 24 })
            loadBlocks()
        } catch (err) { toast.error(err.message || 'Failed to block IP') }
    }

    async function unblock(ip) {
        if (!window.confirm(`Unblock ${ip}?`)) return
        try {
            const res = await fetch(`/api/superadmin/security/blocked-ips?ip=${encodeURIComponent(ip)}`, {
                method: 'DELETE', headers: authHeaders(),
            })
            const data = await res.json()
            if (!data.success) throw new Error(data.message || 'Failed')
            toast.success(`Unblocked ${ip}`)
            loadBlocks()
        } catch (err) { toast.error(err.message || 'Failed') }
    }

    const overviewStats = stats?.stats || {}

    return (
        <div className="p-6 lg:p-8 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                        <svg className="w-6 h-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                        Security Center
                    </h1>
                    <p className="text-sm text-gray-500 mt-1">Monitor failed logins, rate limits, blocked IPs, and suspicious activity across all tenants.</p>
                </div>
                <button
                    onClick={() => { loadStats(); if (activeTab === 'events') loadEvents(); if (activeTab === 'blocked') loadBlocks() }}
                    className="px-4 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition"
                >Refresh</button>
            </div>

            <div className="border-b border-gray-200">
                <nav className="-mb-px flex gap-6">
                    {TABS.map((t) => (
                        <button
                            key={t.id}
                            onClick={() => setActiveTab(t.id)}
                            className={`py-3 px-1 text-sm font-medium border-b-2 transition ${activeTab === t.id ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
                        >{t.label}</button>
                    ))}
                </nav>
            </div>

            {activeTab === 'overview' && (
                <div className="space-y-6">
                    {statsLoading ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                            {[...Array(8)].map((_, i) => (<div key={i} className="h-28 bg-gray-100 rounded-xl animate-pulse" />))}
                        </div>
                    ) : (
                        <>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                <StatCard title="Failed logins (24h)" value={overviewStats.failedLogins24h} hint={`${overviewStats.failedLogins7d || 0} in last 7d`} tone={overviewStats.failedLogins24h > 50 ? 'red' : 'amber'} />
                                <StatCard title="Successful logins (24h)" value={overviewStats.successfulLogins24h} tone="green" />
                                <StatCard title="Account lockouts (24h)" value={overviewStats.lockouts24h} tone={overviewStats.lockouts24h > 0 ? 'red' : 'blue'} />
                                <StatCard title="Rate limit hits (24h)" value={overviewStats.rateLimitHits24h} tone={overviewStats.rateLimitHits24h > 100 ? 'red' : 'amber'} />
                                <StatCard title="Suspicious inputs (24h)" value={overviewStats.suspiciousInputs24h} tone={overviewStats.suspiciousInputs24h > 0 ? 'red' : 'blue'} />
                                <StatCard title="Active IP blocks" value={overviewStats.activeBlocks} tone={overviewStats.activeBlocks > 0 ? 'red' : 'blue'} />
                                <StatCard title="Total events (24h)" value={overviewStats.totalEvents24h} tone="blue" />
                                <StatCard title="Generated" value={stats?.generatedAt ? new Date(stats.generatedAt).toLocaleTimeString() : '—'} tone="blue" />
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Top offending IPs (24h)</h3>
                                    {stats?.topOffendingIps?.length ? (
                                        <div className="space-y-2">
                                            {stats.topOffendingIps.map((row) => (
                                                <div key={row.ip} className="flex items-center justify-between text-sm">
                                                    <code className="text-gray-700">{row.ip}</code>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-gray-500">{row.count} events</span>
                                                        <button onClick={() => { setBlockForm({ ip: row.ip, reason: 'From overview top-offenders', durationHours: 24 }); setActiveTab('blocked') }} className="text-xs text-red-600 hover:underline">Block</button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : <p className="text-sm text-gray-400">No offending IPs.</p>}
                                </div>

                                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Top targeted accounts (24h)</h3>
                                    {stats?.topTargetedAccounts?.length ? (
                                        <div className="space-y-2">
                                            {stats.topTargetedAccounts.map((row) => (
                                                <div key={row.email} className="flex items-center justify-between text-sm">
                                                    <span className="text-gray-700 truncate">{row.email}</span>
                                                    <span className="text-gray-500">{row.count} attempts</span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : <p className="text-sm text-gray-400">No targeted accounts.</p>}
                                </div>
                            </div>

                            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                                <h3 className="text-sm font-semibold text-gray-700 mb-3">Events by type (24h)</h3>
                                <div className="flex flex-wrap gap-2">
                                    {(stats?.eventsByType || []).map((row) => {
                                        const meta = EVENT_TYPE_LABELS[row.type] || { label: row.type, tone: 'gray' }
                                        return <Pill key={row.type} tone={meta.tone}>{meta.label}: {row.count}</Pill>
                                    })}
                                    {!stats?.eventsByType?.length && <p className="text-sm text-gray-400">No events.</p>}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}

            {activeTab === 'events' && (
                <div className="space-y-4">
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                            <select value={eventFilters.type} onChange={(e) => setEventFilters({ ...eventFilters, type: e.target.value })} className="px-3 py-2 border border-gray-200 rounded-lg text-sm">
                                <option value="">All types</option>
                                {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                            </select>
                            <select value={eventFilters.severity} onChange={(e) => setEventFilters({ ...eventFilters, severity: e.target.value })} className="px-3 py-2 border border-gray-200 rounded-lg text-sm">
                                <option value="">All severities</option>
                                <option value="info">Info</option>
                                <option value="low">Low</option>
                                <option value="medium">Medium</option>
                                <option value="high">High</option>
                                <option value="critical">Critical</option>
                            </select>
                            <input type="text" placeholder="IP" value={eventFilters.ip} onChange={(e) => setEventFilters({ ...eventFilters, ip: e.target.value })} className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                            <input type="text" placeholder="Email" value={eventFilters.email} onChange={(e) => setEventFilters({ ...eventFilters, email: e.target.value })} className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                            <select value={eventFilters.sinceHours} onChange={(e) => setEventFilters({ ...eventFilters, sinceHours: Number(e.target.value) })} className="px-3 py-2 border border-gray-200 rounded-lg text-sm">
                                <option value={1}>Last 1h</option>
                                <option value={24}>Last 24h</option>
                                <option value={168}>Last 7d</option>
                                <option value={720}>Last 30d</option>
                            </select>
                        </div>
                        <div className="mt-3 flex items-center justify-between">
                            <p className="text-xs text-gray-500">{eventTotal.toLocaleString()} matching events</p>
                            <button onClick={loadEvents} className="px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg">Apply filters</button>
                        </div>
                    </div>

                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 text-gray-600">
                                    <tr>
                                        <th className="px-4 py-3 text-left font-medium">Time</th>
                                        <th className="px-4 py-3 text-left font-medium">Type</th>
                                        <th className="px-4 py-3 text-left font-medium">Severity</th>
                                        <th className="px-4 py-3 text-left font-medium">IP</th>
                                        <th className="px-4 py-3 text-left font-medium">Email</th>
                                        <th className="px-4 py-3 text-left font-medium">Path</th>
                                        <th className="px-4 py-3 text-left font-medium">Message</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {eventsLoading && (
                                        <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">Loading…</td></tr>
                                    )}
                                    {!eventsLoading && events.length === 0 && (
                                        <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">No events found.</td></tr>
                                    )}
                                    {!eventsLoading && events.map((ev) => {
                                        const meta = EVENT_TYPE_LABELS[ev.type] || { label: ev.type, tone: 'gray' }
                                        return (
                                            <tr key={ev._id} className="hover:bg-gray-50">
                                                <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatTime(ev.createdAt)}</td>
                                                <td className="px-4 py-3"><Pill tone={meta.tone}>{meta.label}</Pill></td>
                                                <td className="px-4 py-3"><Pill tone={SEVERITY_TONE[ev.severity] || 'gray'}>{ev.severity}</Pill></td>
                                                <td className="px-4 py-3 font-mono text-xs text-gray-600">{ev.ip || '—'}</td>
                                                <td className="px-4 py-3 text-gray-700">{ev.email || '—'}</td>
                                                <td className="px-4 py-3 text-gray-500 truncate max-w-[200px]">{ev.path || '—'}</td>
                                                <td className="px-4 py-3 text-gray-700">{ev.message || '—'}</td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'blocked' && (
                <div className="space-y-4">
                    <form onSubmit={submitBlock} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                        <h3 className="text-sm font-semibold text-gray-700 mb-3">Block an IP</h3>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                            <input required type="text" placeholder="IP address" value={blockForm.ip} onChange={(e) => setBlockForm({ ...blockForm, ip: e.target.value })} className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                            <input type="text" placeholder="Reason" value={blockForm.reason} onChange={(e) => setBlockForm({ ...blockForm, reason: e.target.value })} className="px-3 py-2 border border-gray-200 rounded-lg text-sm md:col-span-2" />
                            <select value={blockForm.durationHours} onChange={(e) => setBlockForm({ ...blockForm, durationHours: Number(e.target.value) })} className="px-3 py-2 border border-gray-200 rounded-lg text-sm">
                                <option value={1}>1 hour</option>
                                <option value={24}>24 hours</option>
                                <option value={168}>7 days</option>
                                <option value={720}>30 days</option>
                                <option value={0}>Permanent</option>
                            </select>
                        </div>
                        <button type="submit" className="mt-3 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg">Block IP</button>
                    </form>

                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 text-gray-600">
                                    <tr>
                                        <th className="px-4 py-3 text-left font-medium">IP</th>
                                        <th className="px-4 py-3 text-left font-medium">Reason</th>
                                        <th className="px-4 py-3 text-left font-medium">Source</th>
                                        <th className="px-4 py-3 text-left font-medium">Hits</th>
                                        <th className="px-4 py-3 text-left font-medium">Blocked at</th>
                                        <th className="px-4 py-3 text-left font-medium">Expires</th>
                                        <th className="px-4 py-3 text-right font-medium">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {blocksLoading && <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">Loading…</td></tr>}
                                    {!blocksLoading && blocks.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">No blocked IPs.</td></tr>}
                                    {!blocksLoading && blocks.map((b) => (
                                        <tr key={b._id} className="hover:bg-gray-50">
                                            <td className="px-4 py-3 font-mono text-xs text-gray-700">{b.ip}</td>
                                            <td className="px-4 py-3 text-gray-700">{b.reason || '—'}</td>
                                            <td className="px-4 py-3"><Pill tone={b.source === 'manual' ? 'blue' : 'amber'}>{b.source}</Pill></td>
                                            <td className="px-4 py-3 text-gray-700">{b.hits}</td>
                                            <td className="px-4 py-3 text-gray-500 text-xs">{formatTime(b.blockedAt)}</td>
                                            <td className="px-4 py-3 text-gray-500 text-xs">{b.expiresAt ? formatTime(b.expiresAt) : <Pill tone="red">Permanent</Pill>}</td>
                                            <td className="px-4 py-3 text-right">
                                                <button onClick={() => unblock(b.ip)} className="px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg">Unblock</button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
