'use client'

import { useState, useEffect } from 'react'
import { FaBullhorn } from 'react-icons/fa'
import { useRouter } from 'next/navigation'
import { Card, CardBody, Button, Skeleton, ScrollShadow } from '@heroui/react'

export default function AnnouncementsWidget({ initialData }) {
    const router = useRouter()
    const [announcements, setAnnouncements] = useState([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        // Data provided from unified dashboard call (including empty array)
        if (initialData !== undefined) {
            setAnnouncements(initialData)
            setLoading(false)
            return
        }
        // undefined = standalone mode, self-fetch
        fetchAnnouncements()
    }, [initialData])

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
            <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
                <Skeleton className="h-6 w-1/3 rounded-lg mb-4" />
                <div className="space-y-3">
                    {[1, 2].map(i => (
                        <div key={i} className="space-y-2">
                            <Skeleton className="h-4 w-3/4 rounded-lg" />
                            <Skeleton className="h-12 w-full rounded-lg" />
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    return (
        <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-base sm:text-lg font-bold text-default-900">Announcements</h3>
                <Button
                    variant="light"
                    color="primary"
                    size="sm"
                    onPress={() => router.push('/dashboard/announcements')}
                >
                    View All
                </Button>
            </div>

            <div className="flex-1 flex flex-col">
                <ScrollShadow className="space-y-2 flex-1 max-h-[200px]">
                    {announcements.length === 0 ? (
                        <div className="flex flex-col items-center justify-center text-center py-6">
                            <img
                                src="/assets/Announcement.png"
                                alt="No announcements"
                                className="w-24 h-24 object-contain mb-3"
                            />
                            <p className="text-sm text-default-500">No announcements yet</p>
                        </div>
                    ) : (
                        announcements.slice(0, 5).map((announcement) => (
                            <Card
                                key={announcement._id}
                                isPressable
                                isHoverable
                                onPress={() => router.push('/dashboard/announcements')}
                                className="border border-default-100"
                            >
                                <CardBody className="p-3">
                                    <div className="flex items-center gap-2 mb-1">
                                        <h4 className="text-sm font-semibold text-default-900 truncate flex-1">
                                            {announcement.title}
                                        </h4>
                                        {announcement.priority && (
                                            <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded-full flex-shrink-0 ${announcement.priority === 'high' ? 'bg-red-100 text-red-700' :
                                                    announcement.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                                                        'bg-blue-100 text-blue-700'
                                                }`}>
                                                {announcement.priority}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-default-600 line-clamp-2">
                                        {announcement.content || announcement.message}
                                    </p>
                                    <div className="flex items-center justify-between mt-2">
                                        <p className="text-xs text-default-400">
                                            {new Date(announcement.createdAt).toLocaleDateString()}
                                        </p>
                                        {announcement.createdBy && (
                                            <p className="text-xs text-default-400">
                                                {announcement.createdBy.firstName} {announcement.createdBy.lastName}
                                            </p>
                                        )}
                                    </div>
                                </CardBody>
                            </Card>
                        ))
                    )}
                </ScrollShadow>
            </div>
        </div>
    )
}
