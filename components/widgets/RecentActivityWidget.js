'use client'

import { useState, useEffect } from 'react'
import { FaHistory, FaClock, FaArrowRight, FaArrowLeft, FaCoffee, FaSignOutAlt, FaSignInAlt } from 'react-icons/fa'
import { Card, CardBody, Button, Skeleton, ScrollShadow } from '@heroui/react'

export default function RecentActivityWidget({ limit = 6 }) {
    const [activities, setActivities] = useState([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        fetchRecentActivity()
    }, [])

    const fetchRecentActivity = async () => {
        try {
            const token = localStorage.getItem('token')

            // Try to fetch attendance logs for the user
            const response = await fetch(`/api/attendance/logs?limit=${limit}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            })

            if (response.ok) {
                const data = await response.json()
                if (data.success && data.data?.length > 0) {
                    // Transform attendance data to activity format
                    const activityData = data.data.flatMap(log => {
                        const activities = []
                        if (log.clockIn) {
                            activities.push({
                                type: 'clock-in',
                                time: log.clockIn,
                                date: log.date,
                                description: 'Clocked in'
                            })
                        }
                        if (log.clockOut) {
                            activities.push({
                                type: 'clock-out',
                                time: log.clockOut,
                                date: log.date,
                                description: 'Clocked out'
                            })
                        }
                        if (log.breaks && log.breaks.length > 0) {
                            log.breaks.forEach((brk, idx) => {
                                if (brk.start) {
                                    activities.push({
                                        type: 'break-start',
                                        time: brk.start,
                                        date: log.date,
                                        description: 'Started break'
                                    })
                                }
                                if (brk.end) {
                                    activities.push({
                                        type: 'break-end',
                                        time: brk.end,
                                        date: log.date,
                                        description: 'Ended break'
                                    })
                                }
                            })
                        }
                        return activities
                    })

                    // Sort by time descending and limit
                    activityData.sort((a, b) => new Date(b.time) - new Date(a.time))
                    setActivities(activityData.slice(0, limit))
                } else {
                    setActivities(getPlaceholderActivities())
                }
            } else {
                setActivities(getPlaceholderActivities())
            }
        } catch (error) {
            console.error('Fetch recent activity error:', error)
            setActivities(getPlaceholderActivities())
        } finally {
            setLoading(false)
        }
    }

    const getPlaceholderActivities = () => [
        { type: 'clock-in', time: new Date(), description: 'Clocked in for the day' },
        { type: 'break-start', time: new Date(Date.now() - 2 * 60 * 60 * 1000), description: 'Started lunch break' },
        { type: 'break-end', time: new Date(Date.now() - 1 * 60 * 60 * 1000), description: 'Ended lunch break' },
        { type: 'task', time: new Date(Date.now() - 3 * 60 * 60 * 1000), description: 'Completed task: Review documents' },
        { type: 'leave', time: new Date(Date.now() - 24 * 60 * 60 * 1000), description: 'Leave request approved' },
        { type: 'clock-out', time: new Date(Date.now() - 24 * 60 * 60 * 1000), description: 'Clocked out' }
    ]

    const getActivityIcon = (type) => {
        switch (type) {
            case 'clock-in':
                return <FaSignInAlt className="w-4 h-4 text-success-600" />
            case 'clock-out':
                return <FaSignOutAlt className="w-4 h-4 text-danger-600" />
            case 'break-start':
                return <FaCoffee className="w-4 h-4 text-warning-600" />
            case 'break-end':
                return <FaArrowRight className="w-4 h-4 text-primary-600" />
            case 'leave':
                return <FaArrowLeft className="w-4 h-4 text-secondary-600" />
            default:
                return <FaHistory className="w-4 h-4 text-default-600" />
        }
    }

    const formatTime = (time) => {
        const date = new Date(time)
        const now = new Date()
        const diffMs = now - date
        const diffMins = Math.floor(diffMs / 60000)
        const diffHours = Math.floor(diffMins / 60)
        const diffDays = Math.floor(diffHours / 24)

        if (diffMins < 1) return 'Just now'
        if (diffMins < 60) return `${diffMins}m ago`
        if (diffHours < 24) return `${diffHours}h ago`
        if (diffDays === 1) return 'Yesterday'
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }

    if (loading) {
        return (
            <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
                <Skeleton className="h-6 w-1/3 rounded-lg mb-4" />
                <div className="space-y-3">
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className="flex items-center gap-3">
                            <Skeleton className="w-8 h-8 rounded-full" />
                            <div className="flex-1 space-y-1">
                                <Skeleton className="h-4 w-3/4 rounded-lg" />
                                <Skeleton className="h-3 w-1/4 rounded-lg" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    return (
        <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <FaHistory className="w-5 h-5 text-primary-500" />
                    <h3 className="text-base sm:text-lg font-bold text-default-900">Recent Activity</h3>
                </div>
                <Button
                    variant="light"
                    color="primary"
                    size="sm"
                    as="a"
                    href="/dashboard/attendance"
                >
                    View All
                </Button>
            </div>

            <ScrollShadow className="space-y-2 max-h-48">
                {activities.map((activity, index) => (
                    <Card key={index} className="border border-default-100">
                        <CardBody className="p-2">
                            <div className="flex items-start gap-3">
                                <div className="flex-shrink-0 w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                                    {getActivityIcon(activity.type)}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-default-900 truncate">{activity.description}</p>
                                    <p className="text-xs text-default-500 flex items-center gap-1">
                                        <FaClock className="w-3 h-3" />
                                        {formatTime(activity.time)}
                                    </p>
                                </div>
                            </div>
                        </CardBody>
                    </Card>
                ))}
            </ScrollShadow>
        </div>
    )
}