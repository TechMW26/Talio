'use client'

import { useState, useEffect } from 'react'
import { FaBullseye, FaCheckCircle, FaHourglassHalf, FaExclamationTriangle } from 'react-icons/fa'

export default function GoalsWidget({ userId }) {
    const [goals, setGoals] = useState([])
    const [loading, setLoading] = useState(true)
    const [stats, setStats] = useState({ total: 0, completed: 0, inProgress: 0, overdue: 0 })

    useEffect(() => {
        if (userId) {
            fetchGoals()
        }
    }, [userId])

    const fetchGoals = async () => {
        try {
            const token = localStorage.getItem('token')
            const response = await fetch('/api/performance/goals', {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            const data = await response.json()

            if (data.success) {
                const goalsData = data.data || []
                setGoals(goalsData.slice(0, 5)) // Show only first 5 goals

                // Calculate stats
                const total = goalsData.length
                const completed = goalsData.filter(g => g.status === 'completed').length
                const inProgress = goalsData.filter(g => g.status === 'in_progress').length
                const overdue = goalsData.filter(g => g.isOverdue).length

                setStats({ total, completed, inProgress, overdue })
            }
        } catch (error) {
            console.error('Error fetching goals:', error)
        } finally {
            setLoading(false)
        }
    }

    if (loading) {
        return (
            <div className="p-4 sm:p-6 animate-pulse">
                <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
                <div className="space-y-3">
                    <div className="h-16 bg-gray-200 rounded"></div>
                    <div className="h-16 bg-gray-200 rounded"></div>
                    <div className="h-16 bg-gray-200 rounded"></div>
                </div>
            </div>
        )
    }

    return (
        <div className="p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <FaBullseye className="w-5 h-5 text-primary-500" />
                    <h3 className="text-base sm:text-lg font-bold text-gray-800">My Goals</h3>
                </div>
                <a
                    href="/dashboard/performance/goals"
                    className="text-primary-600 hover:text-primary-800 text-sm font-medium"
                >
                    View All
                </a>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-4 gap-2 mb-4">
                <div className="bg-gray-50 rounded-lg p-2 text-center">
                    <p className="text-lg font-bold text-primary-600">{stats.total}</p>
                    <p className="text-xs text-gray-600">Total</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-2 text-center">
                    <p className="text-lg font-bold text-green-600">{stats.completed}</p>
                    <p className="text-xs text-gray-600">Done</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-2 text-center">
                    <p className="text-lg font-bold text-blue-600">{stats.inProgress}</p>
                    <p className="text-xs text-gray-600">Active</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-2 text-center">
                    <p className="text-lg font-bold text-red-600">{stats.overdue}</p>
                    <p className="text-xs text-gray-600">Overdue</p>
                </div>
            </div>

            {/* Goals List */}
            {goals.length === 0 ? (
                <div className="text-center py-6 text-gray-500">
                    <FaBullseye className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                    <p className="text-sm">No goals set yet</p>
                    <p className="text-xs mt-1">Visit Performance section to create goals</p>
                </div>
            ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                    {goals.map((goal) => (
                        <div key={goal._id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-800 truncate">{goal.title}</p>
                                <div className="flex items-center gap-2 mt-1">
                                    <span className={`text-xs px-2 py-0.5 rounded-full ${goal.status === 'completed' ? 'bg-green-100 text-green-700' :
                                            goal.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                                                goal.isOverdue ? 'bg-red-100 text-red-700' :
                                                    'bg-gray-100 text-gray-700'
                                        }`}>
                                        {goal.status === 'completed' ? 'Completed' :
                                            goal.status === 'in_progress' ? 'In Progress' :
                                                goal.isOverdue ? 'Overdue' : 'Pending'}
                                    </span>
                                    <span className="text-xs text-gray-500">{goal.progress || 0}%</span>
                                </div>
                            </div>
                            <div className="ml-3">
                                {goal.status === 'completed' ? (
                                    <FaCheckCircle className="w-5 h-5 text-green-600" />
                                ) : goal.isOverdue ? (
                                    <FaExclamationTriangle className="w-5 h-5 text-red-600" />
                                ) : (
                                    <FaHourglassHalf className="w-5 h-5 text-primary-600" />
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
