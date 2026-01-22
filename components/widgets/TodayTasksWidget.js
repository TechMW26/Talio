'use client'

import { useState, useEffect } from 'react'
import { FaTasks, FaExclamationTriangle, FaCheckCircle, FaSpinner } from 'react-icons/fa'
import { Card, CardBody, Button, Chip, Skeleton, ScrollShadow, Spinner } from '@heroui/react'

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
            case 'completed': return 'success'
            case 'in_progress': return 'primary'
            case 'assigned': return 'warning'
            case 'review': return 'secondary'
            default: return 'default'
        }
    }

    const getStatusIcon = (status) => {
        switch (status) {
            case 'completed': return <FaCheckCircle className="text-success-500" />
            case 'in_progress': return <Spinner size="sm" color="primary" />
            default: return <FaTasks className="text-default-500" />
        }
    }

    const getPriorityColor = (priority) => {
        switch (priority) {
            case 'high': return 'danger'
            case 'medium': return 'warning'
            case 'low': return 'success'
            default: return 'default'
        }
    }

    if (loading) {
        return (
            <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
                <Skeleton className="h-6 w-1/3 rounded-lg mb-4" />
                <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="flex items-center gap-3">
                            <Skeleton className="w-8 h-8 rounded-full" />
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

    return (
        <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-base sm:text-lg font-bold text-default-900">Today's Tasks</h3>
                <Button
                    variant="light"
                    color="primary"
                    size="sm"
                    as="a"
                    href="/dashboard/projects"
                >
                    View All
                </Button>
            </div>
            
            <ScrollShadow className="space-y-2 max-h-[200px]">
                {tasks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-center py-6">
                        <div className="w-14 h-14 rounded-full bg-primary-100 flex items-center justify-center mb-3">
                            <FaTasks className="w-7 h-7 text-primary-400" />
                        </div>
                        <p className="text-sm text-default-500">No tasks due today</p>
                    </div>
                ) : (
                    tasks.map((task, index) => (
                        <Card
                            key={task._id || index}
                            className="bg-default-50 border border-default-100"
                        >
                            <CardBody className="p-3">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                        <div className="flex-shrink-0">
                                            {getStatusIcon(task.status)}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-semibold text-default-900 truncate">
                                                #{task.taskNumber} - {task.title}
                                            </p>
                                            <div className="flex items-center gap-2 mt-1">
                                                {task.priority && (
                                                    <Chip size="sm" color={getPriorityColor(task.priority)} variant="flat">
                                                        {task.priority.toUpperCase()}
                                                    </Chip>
                                                )}
                                                <span className="text-xs text-default-500">
                                                    {task.progress || 0}% complete
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <Chip size="sm" color={getStatusColor(task.status)} variant="flat" className="ml-2">
                                        {task.status?.replace('_', ' ')}
                                    </Chip>
                                </div>
                            </CardBody>
                        </Card>
                    ))
                )}
            </ScrollShadow>
        </div>
    )
}
