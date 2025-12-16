'use client'

import { useState, useEffect } from 'react'
import { FaGraduationCap, FaCheckCircle, FaSpinner, FaPlayCircle } from 'react-icons/fa'

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
                    <span className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-green-100 text-green-700">
                        <FaCheckCircle className="w-3 h-3" /> Completed
                    </span>
                )
            case 'In Progress':
                return (
                    <span className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-700">
                        <FaSpinner className="w-3 h-3" /> In Progress
                    </span>
                )
            default:
                return (
                    <span className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-700">
                        <FaPlayCircle className="w-3 h-3" /> Not Started
                    </span>
                )
        }
    }

    if (loading) {
        return (
            <div className="p-4 sm:p-6 animate-pulse">
                <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
                <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="space-y-2">
                            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                            <div className="h-2 bg-gray-200 rounded"></div>
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    return (
        <div className="p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-base sm:text-lg font-bold text-gray-800">Learning Progress</h3>
                <a
                    href="/dashboard/learning"
                    className="text-primary-600 hover:text-primary-800 text-sm font-medium"
                >
                    View All
                </a>
            </div>
            
            <div className="space-y-3 max-h-48 overflow-y-auto">
            {courses.map((course, index) => (
                <div key={index} className="p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium text-gray-800 truncate pr-2 flex-1">
                            {course.course || course.title}
                        </h4>
                        {getStatusBadge(course.status)}
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                            className={`h-2 rounded-full transition-all duration-300 ${course.progress === 100 ? 'bg-green-600' :
                                    course.progress > 0 ? 'bg-primary-600' : 'bg-gray-300'
                                }`}
                            style={{ width: `${course.progress}%` }}
                        ></div>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{course.progress}% complete</p>
                </div>
            ))}
            </div>
        </div>
    )
}
