'use client'

import { useState, useEffect } from 'react'
import { FaBullhorn } from 'react-icons/fa'
import { useRouter } from 'next/navigation'

export default function AnnouncementsWidget() {
    const router = useRouter()
    const [announcements, setAnnouncements] = useState([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        fetchAnnouncements()
    }, [])

    const fetchAnnouncements = async () => {
        try {
            const token = localStorage.getItem('token')
            const response = await fetch('/api/announcements?limit=5', {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            const data = await response.json()
            if (data.success) {
                setAnnouncements(data.data || [])
            }
        } catch (error) {
            console.error('Error fetching announcements:', error)
        } finally {
            setLoading(false)
        }
    }

    if (loading) {
        return (
            <div className="p-4 sm:p-6 animate-pulse">
                <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
                <div className="space-y-3">
                    {[1, 2].map(i => (
                        <div key={i} className="h-20 bg-gray-200 rounded"></div>
                    ))}
                </div>
            </div>
        )
    }

    return (
        <div className="p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-base sm:text-lg font-bold text-gray-800">Announcements</h3>
                <button
                    onClick={() => router.push('/dashboard/announcements')}
                    className="text-primary-600 hover:text-primary-800 text-sm font-medium"
                >
                    View All
                </button>
            </div>

            {announcements.length === 0 ? (
                <div className="text-center py-6 text-gray-500">
                    <FaBullhorn className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                    <p className="text-sm">No announcements</p>
                </div>
            ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                    {announcements.slice(0, 5).map((announcement) => (
                        <div
                            key={announcement._id}
                            className="p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                            onClick={() => router.push(`/dashboard/announcements/${announcement._id}`)}
                        >
                            <h4 className="text-sm font-medium text-gray-800 truncate mb-1">{announcement.title}</h4>
                            <p className="text-xs text-gray-600 line-clamp-2">{announcement.message}</p>
                            <p className="text-xs text-gray-400 mt-2">
                                {new Date(announcement.createdAt).toLocaleDateString()}
                            </p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
