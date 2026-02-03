'use client'

import { useState, useEffect } from 'react'
import { FaGraduationCap, FaCheckCircle, FaSpinner, FaPlayCircle } from 'react-icons/fa'
import { Card, CardBody, Button, Chip, Progress, Skeleton, ScrollShadow } from '@heroui/react'

export default function LearningProgressWidget({ limit = 4 }) {
    const [courses, setCourses] = useState([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        fetchLearningProgress()
    }, [])

    const fetchLearningProgress = async () => {
        try {
            const token = localStorage.getItem('token')
            const response = await fetch(`/api/learning/progress?limit=${limit}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            })

            if (response.ok) {
                const data = await response.json()
                if (data.success && data.data?.length > 0) {
                    setCourses(data.data)
                } else {
                    // Use placeholder data if no real data
                    setCourses([
                        { course: 'Company Policies', progress: 100, status: 'Completed' },
                        { course: 'Security Training', progress: 75, status: 'In Progress' },
                        { course: 'Communication Skills', progress: 30, status: 'In Progress' },
                        { course: 'Time Management', progress: 0, status: 'Not Started' },
                    ])
                }
            } else {
                // Fallback placeholder
                setCourses([
                    { course: 'Company Policies', progress: 100, status: 'Completed' },
                    { course: 'Security Training', progress: 75, status: 'In Progress' },
                    { course: 'Communication Skills', progress: 30, status: 'In Progress' },
                    { course: 'Time Management', progress: 0, status: 'Not Started' },
                ])
            }
        } catch (error) {
            console.error('Fetch learning progress error:', error)
            // Fallback placeholder
            setCourses([
                { course: 'Company Policies', progress: 100, status: 'Completed' },
                { course: 'Security Training', progress: 75, status: 'In Progress' },
                { course: 'Communication Skills', progress: 30, status: 'In Progress' },
                { course: 'Time Management', progress: 0, status: 'Not Started' },
            ])
        } finally {
            setLoading(false)
        }
    }

    const getStatusBadge = (status) => {
        switch (status) {
            case 'Completed':
                return (
                    <Chip size="sm" color="success" variant="flat" startContent={<FaCheckCircle className="w-3 h-3" />}>
                        Completed
                    </Chip>
                )
            case 'In Progress':
                return (
                    <Chip size="sm" color="primary" variant="flat" startContent={<FaSpinner className="w-3 h-3" />}>
                        In Progress
                    </Chip>
                )
            default:
                return (
                    <Chip size="sm" color="default" variant="flat" startContent={<FaPlayCircle className="w-3 h-3" />}>
                        Not Started
                    </Chip>
                )
        }
    }

    if (loading) {
        return (
            <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
                <Skeleton className="h-6 w-1/3 rounded-lg mb-4" />
                <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="space-y-2">
                            <Skeleton className="h-4 w-3/4 rounded-lg" />
                            <Skeleton className="h-2 w-full rounded-lg" />
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    return (
        <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-base sm:text-lg font-bold text-default-900">Learning Progress</h3>
                <Button
                    variant="light"
                    color="primary"
                    size="sm"
                    as="a"
                    href="/dashboard/learning"
                >
                    View All
                </Button>
            </div>

            <ScrollShadow className="space-y-3 max-h-48">
                {courses.map((course, index) => (
                    <Card key={index} className="border border-default-100">
                        <CardBody className="p-3">
                            <div className="flex items-center justify-start mb-2">
                                <h4 className="text-sm font-semibold text-default-900 truncate pr-2 flex-1">
                                    {course.course || course.title}
                                </h4>
                                {getStatusBadge(course.status)}
                            </div>
                            <Progress
                                size="sm"
                                value={course.progress}
                                color={course.progress === 100 ? 'success' : course.progress > 0 ? 'primary' : 'default'}
                                className="mb-1"
                            />
                            <p className="text-xs text-default-500">{course.progress}% complete</p>
                        </CardBody>
                    </Card>
                ))}
            </ScrollShadow>
        </div>
    )
}
