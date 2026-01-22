'use client'

import { useState, useEffect } from 'react'
import { FaBullhorn } from 'react-icons/fa'
import { useRouter } from 'next/navigation'
import { Card, CardBody, Button, Skeleton, ScrollShadow } from '@heroui/react'

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
                            <div className="w-16 h-16 rounded-full bg-primary-100 flex items-center justify-center mb-3">
                                <FaBullhorn className="w-8 h-8 text-primary-400" />
                            </div>
                            <p className="text-sm text-default-500">No announcements yet</p>
                        </div>
                    ) : (
                        announcements.slice(0, 5).map((announcement) => (
                            <Card
                                key={announcement._id}
                                isPressable
                                isHoverable
                                onPress={() => router.push(`/dashboard/announcements/${announcement._id}`)}
                                className="bg-default-50 border border-default-100"
                            >
                                <CardBody className="p-3">
                                    <h4 className="text-sm font-semibold text-default-900 truncate mb-1">
                                        {announcement.title}
                                    </h4>
                                    <p className="text-xs text-default-600 line-clamp-2">
                                        {announcement.message}
                                    </p>
                                    <p className="text-xs text-default-400 mt-2">
                                        {new Date(announcement.createdAt).toLocaleDateString()}
                                    </p>
                                </CardBody>
                            </Card>
                        ))
                    )}
                </ScrollShadow>
            </div>
        </div>
    )
}
