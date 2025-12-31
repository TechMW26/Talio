'use client'

import { useState, useEffect, useCallback } from 'react'
import {
    FaCode, FaServer, FaRobot, FaCloud, FaMobileAlt,
    FaShieldAlt, FaDatabase, FaBriefcase, FaMicrochip,
    FaExternalLinkAlt
} from 'react-icons/fa'
import { HiOutlineNewspaper } from 'react-icons/hi2'

// Category icons and colors matching other widgets
const CATEGORY_CONFIG = {
    frontend: { icon: FaCode, color: 'text-blue-600', bg: 'bg-blue-100' },
    backend: { icon: FaServer, color: 'text-green-600', bg: 'bg-green-100' },
    ai: { icon: FaRobot, color: 'text-purple-600', bg: 'bg-purple-100' },
    cloud: { icon: FaCloud, color: 'text-cyan-600', bg: 'bg-cyan-100' },
    mobile: { icon: FaMobileAlt, color: 'text-orange-600', bg: 'bg-orange-100' },
    security: { icon: FaShieldAlt, color: 'text-red-600', bg: 'bg-red-100' },
    data: { icon: FaDatabase, color: 'text-indigo-600', bg: 'bg-indigo-100' },
    business: { icon: FaBriefcase, color: 'text-amber-600', bg: 'bg-amber-100' },
    tech: { icon: FaMicrochip, color: 'text-gray-600', bg: 'bg-gray-100' }
}

export default function RoleNewsWidget() {
    const [news, setNews] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)

    const fetchNews = useCallback(async () => {
        try {
            setLoading(true)
            setError(null)

            const token = localStorage.getItem('token')
            const response = await fetch('/api/dashboard/role-news', {
                headers: { 'Authorization': `Bearer ${token}` }
            })

            const data = await response.json()

            if (data.success) {
                setNews(data.news || [])
            } else {
                setError(data.message || 'Failed to load news')
            }
        } catch (err) {
            console.error('[RoleNewsWidget] Error:', err)
            setError('Failed to load news')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchNews()
    }, [fetchNews])

    // Loading skeleton - matches AnnouncementsWidget style
    if (loading) {
        return (
            <div className="p-4 sm:p-6 animate-pulse flex-1 flex flex-col h-full">
                <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
                <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="h-16 bg-gray-200 rounded"></div>
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
                    <h3 className="text-base sm:text-lg font-bold text-gray-800">Latest News</h3>
                </div>
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-center text-gray-500">
                        <HiOutlineNewspaper className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                        <p className="text-sm">{error}</p>
                        <button
                            onClick={fetchNews}
                            className="mt-2 text-primary-600 hover:text-primary-800 text-sm font-medium"
                        >
                            Retry
                        </button>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
            {/* Header - matches other widgets */}
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-base sm:text-lg font-bold text-gray-800">Latest News</h3>
                <button
                    onClick={fetchNews}
                    className="text-primary-600 hover:text-primary-800 text-sm font-medium"
                >
                    Refresh
                </button>
            </div>

            {/* News List */}
            <div className="flex-1 flex flex-col">
                {news.length === 0 ? (
                    <div className="text-center py-6 text-gray-500 flex-1 flex flex-col justify-center">
                        <HiOutlineNewspaper className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                        <p className="text-sm">No news available</p>
                    </div>
                ) : (
                    <div className="space-y-2 overflow-y-auto flex-1 max-h-64">
                        {news.map((item, index) => {
                            const config = CATEGORY_CONFIG[item.category] || CATEGORY_CONFIG.tech
                            const Icon = config.icon

                            return (
                                <a
                                    key={index}
                                    href={item.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors group"
                                >
                                    {/* Icon */}
                                    <div className={`w-10 h-10 ${config.bg} rounded-full flex items-center justify-center flex-shrink-0`}>
                                        <Icon className={`w-5 h-5 ${config.color}`} />
                                    </div>

                                    {/* Content */}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-gray-800 line-clamp-2 group-hover:text-primary-600 transition-colors">
                                            {item.title}
                                        </p>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className="text-xs text-gray-500 truncate max-w-[100px]">{item.source}</span>
                                            <span className="text-xs text-gray-400">•</span>
                                            <span className="text-xs text-gray-400">{item.time}</span>
                                        </div>
                                    </div>

                                    {/* External link indicator */}
                                    <FaExternalLinkAlt className="w-3 h-3 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                                </a>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    )
}
