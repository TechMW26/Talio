'use client'

import { useState, useEffect } from 'react'
import { FaCalendarAlt, FaGift } from 'react-icons/fa'
import { useRouter } from 'next/navigation'
import { Card, CardBody, Button, Chip, Skeleton, ScrollShadow } from '@heroui/react'

export default function HolidaysWidget({ limit = 5, initialData }) {
    const router = useRouter()
    const [holidays, setHolidays] = useState([])
    const [loading, setLoading] = useState(!initialData)

    useEffect(() => {
        // Skip fetch if initialData provided from unified dashboard call
        if (initialData) {
            setHolidays(initialData)
            setLoading(false)
            return
        }
        fetchHolidays()
    }, [initialData])

    const fetchHolidays = async () => {
        try {
            const token = localStorage.getItem('token')
            const response = await fetch(`/api/holidays?limit=${limit}&upcoming=true`, {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            const data = await response.json()
            if (data.success) {
                setHolidays(data.data || [])
            }
        } catch (error) {
            console.error('Fetch holidays error:', error)
        } finally {
            setLoading(false)
        }
    }

    const formatDate = (dateStr) => {
        const date = new Date(dateStr)
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    }

    const getDaysUntil = (dateStr) => {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const holidayDate = new Date(dateStr)
        holidayDate.setHours(0, 0, 0, 0)
        const diffTime = holidayDate - today
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
        return diffDays
    }

    if (loading) {
        return (
            <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
                <Skeleton className="h-6 w-1/3 rounded-lg mb-4" />
                <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="flex items-center gap-3">
                            <Skeleton className="w-10 h-10 rounded-full" />
                            <div className="flex-1 space-y-2">
                                <Skeleton className="h-4 w-3/4 rounded-lg" />
                                <Skeleton className="h-3 w-1/2 rounded-lg" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    const upcomingHolidays = (holidays || [])
        .filter(holiday => getDaysUntil(holiday.date) >= 0)
        .sort((a, b) => new Date(a.date) - new Date(b.date))

    const itemColors = [
        'bg-blue-50/80',
        'bg-emerald-50/80',
        'bg-amber-50/80',
        'bg-purple-50/80',
        'bg-rose-50/80'
    ]

    return (
        <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-base sm:text-lg font-bold text-default-900">Upcoming Holidays</h3>
                <Button
                    variant="light"
                    color="primary"
                    size="sm"
                    onPress={() => router.push('/dashboard/holidays')}
                >
                    View All
                </Button>
            </div>

            <ScrollShadow className="space-y-2 max-h-[200px]">
                {upcomingHolidays.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-center py-6">
                        <img
                            src="/assets/Holiday.png"
                            alt="No upcoming holidays"
                            className="w-24 h-24 object-contain mb-3"
                        />
                        <p className="text-sm text-default-500">No upcoming holidays</p>
                    </div>
                ) : (
                    upcomingHolidays.map((holiday, index) => {
                        const daysUntil = getDaysUntil(holiday.date)
                        return (
                            <Card
                                key={holiday._id || index}
                                className={`border-0 shadow-none ${itemColors[index % itemColors.length]}`}
                            >
                                <CardBody className="p-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-3 min-w-0 flex-1">
                                            <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center flex-shrink-0">
                                                <FaGift className="w-5 h-5 text-primary-600" />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-sm font-semibold text-default-900 truncate">{holiday.name}</p>
                                                <p className="text-xs text-default-500">{formatDate(holiday.date)}</p>
                                            </div>
                                        </div>
                                        <div className="flex-shrink-0 ml-2">
                                            {daysUntil === 0 ? (
                                                <Chip color="success" size="sm" variant="flat">Today!</Chip>
                                            ) : daysUntil === 1 ? (
                                                <Chip color="warning" size="sm" variant="flat">Tomorrow</Chip>
                                            ) : daysUntil > 0 ? (
                                                <span className="text-xs text-default-500 font-medium">{daysUntil} days</span>
                                            ) : (
                                                <Chip color="default" size="sm" variant="flat">Passed</Chip>
                                            )}
                                        </div>
                                    </div>
                                </CardBody>
                            </Card>
                        )
                    })
                )}
            </ScrollShadow>
        </div>
    )
}