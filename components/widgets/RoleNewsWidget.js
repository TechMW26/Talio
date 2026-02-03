'use client'

import { useState, useEffect, useCallback } from 'react'
import {
    FaCode, FaServer, FaRobot, FaCloud, FaMobileAlt,
    FaShieldAlt, FaDatabase, FaBriefcase, FaMicrochip,
    FaExternalLinkAlt
} from 'react-icons/fa'
import { HiOutlineNewspaper } from 'react-icons/hi2'
import { Button, Skeleton, ScrollShadow } from '@heroui/react'

// Category icons and colors matching other widgets
const CATEGORY_CONFIG = {
    frontend: { icon: FaCode, color: 'text-primary-600', bg: 'bg-primary-100' },
    backend: { icon: FaServer, color: 'text-success-600', bg: 'bg-success-100' },
    ai: { icon: FaRobot, color: 'text-secondary-600', bg: 'bg-secondary-100' },
    cloud: { icon: FaCloud, color: 'text-primary-500', bg: 'bg-primary-50' },
    mobile: { icon: FaMobileAlt, color: 'text-warning-600', bg: 'bg-warning-100' },
    security: { icon: FaShieldAlt, color: 'text-danger-600', bg: 'bg-danger-100' },
    data: { icon: FaDatabase, color: 'text-secondary-600', bg: 'bg-secondary-100' },
    business: { icon: FaBriefcase, color: 'text-warning-600', bg: 'bg-warning-100' },
    tech: { icon: FaMicrochip, color: 'text-default-600', bg: 'bg-default-100' }
}

export default function RoleNewsWidget() {
    const [news, setNews] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [retryCount, setRetryCount] = useState(0)
    const MAX_RETRIES = 3

    const fetchNews = useCallback(async (isRetry = false) => {
        try {
            setLoading(true)
            if (!isRetry) {
                setError(null)
                setRetryCount(0)
            }

            const token = localStorage.getItem('token')
            const response = await fetch('/api/dashboard/role-news?fresh=true', {
                headers: { 'Authorization': `Bearer ${token}` }
            })

            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`)
            }

            const data = await response.json()

            if (data.success) {
                setNews(data.news || [])
                setRetryCount(0)
            } else {
                setError(data.message || 'Failed to load news')
            }
        } catch (err) {
            console.error('[RoleNewsWidget] Error:', err)

            // Detect network errors vs other errors
            const isNetworkError = err.name === 'TypeError' &&
                (err.message === 'Failed to fetch' || err.message.includes('NetworkError') || err.message.includes('network'))

            if (isNetworkError && retryCount < MAX_RETRIES) {
                // Retry with exponential backoff for transient network failures
                const delay = Math.min(1000 * Math.pow(2, retryCount), 8000)
                console.log(`[RoleNewsWidget] Network error, retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`)
                setRetryCount(prev => prev + 1)
                setTimeout(() => fetchNews(true), delay)
                return
            }

            if (isNetworkError) {
                setError('Network unavailable. Check your connection.')
            } else if (err.message?.includes('Server error')) {
                setError('Server temporarily unavailable. Try again later.')
            } else {
                setError('Failed to load news')
            }
        } finally {
            setLoading(false)
        }
    }, [retryCount])

    useEffect(() => {
        fetchNews()
    }, [fetchNews])

    // Loading skeleton
    if (loading) {
        return (
            <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
                <Skeleton className="h-6 w-1/3 rounded-lg mb-4" />
                <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="flex items-center gap-3">
                            <Skeleton className="w-10 h-10 rounded-full" />
                            <div className="flex-1 space-y-2">
                                <Skeleton className="h-4 w-full rounded-lg" />
                                <Skeleton className="h-3 w-1/2 rounded-lg" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    // Error state
    if (error) {
        return (
            <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base sm:text-lg font-bold text-default-900">Latest News</h3>
                </div>
                <div className="flex-1 flex items-center justify-center">
                    <div className="flex flex-col items-center text-center">
                        <div className="w-14 h-14 rounded-full bg-default-100 flex items-center justify-center mb-3">
                            <HiOutlineNewspaper className="w-7 h-7 text-default-400" />
                        </div>
                        <p className="text-sm text-default-500">{error}</p>
                        <Button
                            variant="light"
                            color="primary"
                            size="sm"
                            onPress={fetchNews}
                            className="mt-2"
                        >
                            Retry
                        </Button>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-base sm:text-lg font-bold text-default-900">Latest News</h3>
                <Button
                    variant="light"
                    color="primary"
                    size="sm"
                    onPress={fetchNews}
                >
                    Refresh
                </Button>
            </div>

            {/* News List */}
            <div className="flex-1 flex flex-col">
                <ScrollShadow className="space-y-2 flex-1 max-h-[200px]">
                    {news.length === 0 ? (
                        <div className="flex flex-col items-center justify-center text-center py-6">
                            <img
                                src="/assets/News.png"
                                alt="No news"
                                className="w-24 h-24 object-contain mb-3"
                            />
                            <p className="text-sm text-default-500">No breaking updates right now.</p>
                            <p className="text-xs text-default-400 mt-1">Showing the freshest items as they appear.</p>
                        </div>
                    ) : (
                        news.map((item, index) => {
                            const config = CATEGORY_CONFIG[item.category] || CATEGORY_CONFIG.tech
                            const Icon = config.icon

                            return (
                                <a
                                    key={index}
                                    href={item.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-3 p-3 rounded-xl transition-colors group border border-default-100"
                                >
                                    {/* Icon */}
                                    <div className={`w-10 h-10 ${config.bg} rounded-full flex items-center justify-center flex-shrink-0`}>
                                        <Icon className={`w-5 h-5 ${config.color}`} />
                                    </div>

                                    {/* Content */}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-default-900 line-clamp-2 group-hover:text-primary-600 transition-colors">
                                            {item.title}
                                        </p>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className="text-xs text-default-500 truncate max-w-[100px]">{item.source}</span>
                                            <span className="text-xs text-default-400">•</span>
                                            <span className="text-xs text-default-400">{item.time}</span>
                                        </div>
                                    </div>

                                    {/* External link indicator */}
                                    <FaExternalLinkAlt className="w-3 h-3 text-default-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                                </a>
                            )
                        })
                    )}
                </ScrollShadow>
            </div>
        </div>
    )
}
