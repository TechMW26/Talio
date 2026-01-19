'use client'

import { useState, useEffect } from 'react'
import { FaCalendarAlt, FaGift } from 'react-icons/fa'
import { useRouter } from 'next/navigation'

export default function HolidaysWidget({ limit = 5 }) {
    const router = useRouter()
    const [holidays, setHolidays] = useState([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        fetchHolidays()
    }, [])

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
            <div className="p-4 sm:p-6 animate-pulse flex-1 flex flex-col h-full">
                <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
                <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="h-16 bg-gray-200 rounded"></div>
                    ))}
                </div>
            </div>
        )
    }

    return (
        <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-base sm:text-lg font-bold text-gray-800">Upcoming Holidays</h3>
                <button
                    onClick={() => router.push('/dashboard/holidays')}
                    className="text-primary-600 hover:text-primary-800 text-sm font-medium"
                >
                    View All
                </button>
            </div>
            
            <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {holidays.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-center py-4 text-gray-500">
                        <img
                            src="/assets/Holiday.png"
                            alt="No upcoming holidays"
                            className="w-28 h-28 object-contain mb-2"
                        />
                        <p className="text-sm">No upcoming holidays</p>
                    </div>
                ) : (
                    holidays.map((holiday, index) => {
                        const daysUntil = getDaysUntil(holiday.date)
                        return (
                            <div
                                key={holiday._id || index}
                                className="flex items-center justify-between gap-2 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                            >
                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                    <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                                        <FaGift className="w-5 h-5 text-primary-600" />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium text-gray-800 truncate">{holiday.name}</p>
                                        <p className="text-xs text-gray-500">{formatDate(holiday.date)}</p>
                                    </div>
                                </div>
                                <div className="flex-shrink-0 ml-2">
                                    {daysUntil === 0 ? (
                                        <span className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded-full font-medium">Today!</span>
                                    ) : daysUntil === 1 ? (
                                        <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-700 rounded-full font-medium">Tomorrow</span>
                                    ) : daysUntil > 0 ? (
                                        <span className="text-xs text-gray-500 font-medium">{daysUntil} days</span>
                                    ) : (
                                        <span className="text-xs text-gray-400">Passed</span>
                                    )}
                                </div>
                            </div>
                        )
                    })
                )}
            </div>
        </div>
    )
}