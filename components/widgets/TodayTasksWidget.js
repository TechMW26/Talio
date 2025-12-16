'use client'

import { useState, useEffect } from 'react'
import { FaTasks, FaExclamationTriangle, FaCheckCircle, FaSpinner } from 'react-icons/fa'

export default function TodayTasksWidget({ limit = 5 }) {
    const [tasks, setTasks] = useState([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        fetchTodayTasks()
    }, [])

    const fetchTodayTasks = async () => {
        try {
            const token = localStorage.getItem('token')
            const today = new Date().toISOString().split('T')[0]

            const response = await fetch(`/api/tasks?view=personal&dueDate=${today}&limit=${limit}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            })

            if (response.ok) {
                const data = await response.json()
                setTasks(data.data || [])
            }
        } catch (error) {
            console.error('Fetch today tasks error:', error)
        } finally {
            setLoading(false)
        }
    }

    const getStatusColor = (status) => {
        switch (status) {
            case 'completed': return 'bg-green-100 text-green-800'
            case 'in_progress': return 'bg-blue-100 text-blue-800'
            case 'assigned': return 'bg-yellow-100 text-yellow-800'
            case 'review': return 'bg-purple-100 text-purple-800'
            default: return 'bg-gray-100 text-gray-800'
        }
    }

    const getStatusIcon = (status) => {
        switch (status) {
            case 'completed': return <FaCheckCircle className="text-green-500" />
            case 'in_progress': return <FaSpinner className="text-blue-500 animate-spin" />
            default: return <FaTasks className="text-gray-500" />
        }
    }

    const getPriorityColor = (priority) => {
        switch (priority) {
            case 'high': return 'text-red-600'
            case 'medium': return 'text-yellow-600'
            case 'low': return 'text-green-600'
            default: return 'text-gray-600'
        }
    }

    if (loading) {
        return (
            <div className="p-4 sm:p-6 animate-pulse">
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
        <div className="p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-base sm:text-lg font-bold text-gray-800">Today's Tasks</h3>
                <a
                    href="/dashboard/projects"
                    className="text-primary-600 hover:text-primary-800 text-sm font-medium"
                >
                    View All
                </a>
            </div>
            
            <div className="space-y-2 max-h-48 overflow-y-auto">
            {tasks.length > 0 ? (
                tasks.map((task, index) => (
                    <div
                        key={task._id || index}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className="flex-shrink-0">
                                {getStatusIcon(task.status)}
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-gray-800 truncate">
                                    #{task.taskNumber} - {task.title}
                                </p>
                                <div className="flex items-center gap-2 mt-1">
                                    {task.priority && (
                                        <span className={`text-xs font-medium ${getPriorityColor(task.priority)}`}>
                                            {task.priority.toUpperCase()}
                                        </span>
                                    )}
                                    <span className="text-xs text-gray-500">
                                        {task.progress || 0}% complete
                                    </span>
                                </div>
                            </div>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded-full ml-2 ${getStatusColor(task.status)}`}>
                            {task.status?.replace('_', ' ')}
                        </span>
                    </div>
                ))
            ) : (
                <div className="text-center py-6 text-gray-500">
                    <FaCheckCircle className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                    <p className="text-sm">No tasks due today</p>
                    <p className="text-xs text-gray-400 mt-1">You're all caught up!</p>
                </div>
            )}
            </div>
        </div>
    )
}
