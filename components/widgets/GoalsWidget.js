'use client'

import { useState, useEffect } from 'react'
import { FaBullseye, FaCheckCircle, FaHourglassHalf, FaExclamationTriangle } from 'react-icons/fa'
import { Card, CardBody, Button, Chip, Skeleton, ScrollShadow } from '@heroui/react'

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
            <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
                <Skeleton className="h-6 w-1/3 rounded-lg mb-4" />
                <div className="grid grid-cols-4 gap-2 mb-4">
                    {[1, 2, 3, 4].map(i => (
                        <Skeleton key={i} className="h-16 rounded-xl" />
                    ))}
                </div>
                <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                        <Skeleton key={i} className="h-16 rounded-xl" />
                    ))}
                </div>
            </div>
        )
    }

    return (
        <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-base sm:text-lg font-bold text-default-900">My Goals</h3>
                <Button
                    variant="light"
                    color="primary"
                    size="sm"
                    as="a"
                    href="/dashboard/performance/goals"
                >
                    View All
                </Button>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-4 gap-2 mb-4">
                <Card className="bg-primary-50 border border-primary-100">
                    <CardBody className="p-2 text-center">
                        <p className="text-lg font-bold text-primary-600">{stats.total}</p>
                        <p className="text-xs text-default-600">Total</p>
                    </CardBody>
                </Card>
                <Card className="bg-success-50 border border-success-100">
                    <CardBody className="p-2 text-center">
                        <p className="text-lg font-bold text-success-600">{stats.completed}</p>
                        <p className="text-xs text-default-600">Done</p>
                    </CardBody>
                </Card>
                <Card className="bg-primary-50 border border-primary-100">
                    <CardBody className="p-2 text-center">
                        <p className="text-lg font-bold text-primary-600">{stats.inProgress}</p>
                        <p className="text-xs text-default-600">Active</p>
                    </CardBody>
                </Card>
                <Card className="bg-danger-50 border border-danger-100">
                    <CardBody className="p-2 text-center">
                        <p className="text-lg font-bold text-danger-600">{stats.overdue}</p>
                        <p className="text-xs text-default-600">Overdue</p>
                    </CardBody>
                </Card>
            </div>

            {/* Goals List */}
            {goals.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-6">
                    <div className="w-14 h-14 rounded-full bg-primary-100 flex items-center justify-center mb-3">
                        <FaBullseye className="w-7 h-7 text-primary-400" />
                    </div>
                    <p className="text-sm text-default-500">No goals set yet</p>
                    <p className="text-xs text-default-400 mt-1">Visit Performance section to create goals</p>
                </div>
            ) : (
                <ScrollShadow className="space-y-2 max-h-[200px]">
                    {goals.map((goal) => (
                        <Card key={goal._id} className="border border-default-100">
                            <CardBody className="p-3">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-default-900 truncate">{goal.title}</p>
                                        <div className="flex items-center gap-2 mt-1">
                                            <Chip
                                                size="sm"
                                                variant="flat"
                                                color={
                                                    goal.status === 'completed' ? 'success' :
                                                        goal.status === 'in_progress' ? 'primary' :
                                                            goal.isOverdue ? 'danger' : 'default'
                                                }
                                            >
                                                {goal.status === 'completed' ? 'Completed' :
                                                    goal.status === 'in_progress' ? 'In Progress' :
                                                        goal.isOverdue ? 'Overdue' : 'Pending'}
                                            </Chip>
                                            <span className="text-xs text-default-500">{goal.progress || 0}%</span>
                                        </div>
                                    </div>
                                    <div className="ml-3">
                                        {goal.status === 'completed' ? (
                                            <FaCheckCircle className="w-5 h-5 text-success-600" />
                                        ) : goal.isOverdue ? (
                                            <FaExclamationTriangle className="w-5 h-5 text-danger-600" />
                                        ) : (
                                            <FaHourglassHalf className="w-5 h-5 text-primary-600" />
                                        )}
                                    </div>
                                </div>
                            </CardBody>
                        </Card>
                    ))}
                </ScrollShadow>
            )}
        </div>
    )
}
