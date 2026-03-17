'use client'

import { useState, useEffect, useMemo } from 'react'
import { Button } from '@heroui/react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'
import {
  HiOutlineLightBulb,
  HiOutlinePlus,
  HiOutlineMagnifyingGlass,
  HiOutlineFunnel,
  HiOutlineChevronLeft,
  HiOutlineChevronRight,
  HiOutlineUserCircle,
  HiOutlineChatBubbleLeft,
  HiOutlineHandThumbUp,
  HiOutlineHandThumbDown,
  HiOutlineSparkles,
  HiOutlineEyeSlash,
  HiOutlineTrash,
  HiOutlineMapPin,
  HiOutlineBuildingOffice2,
  HiOutlineCheck
} from 'react-icons/hi2'
import { FaThumbtack, FaUserSecret, FaPaperPlane } from 'react-icons/fa'
import toast from '@/utils/toast'
import CreateIdeaModal from './components/CreateIdeaModal'
import IdeaCard from './components/IdeaCard'

export default function SandboxPage() {
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [filter, setFilter] = useState({
    tab: 'all',
    department: '',
    pinned: false
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const limit = 20

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // User from localStorage
  const user = useMemo(() => {
    if (typeof window === 'undefined') return null
    try { return JSON.parse(localStorage.getItem('user')) } catch { return null }
  }, [])

  // Build SWR key with query params
  const swrKey = useMemo(() => {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString()
    })
    if (filter.tab !== 'all') params.append('tab', filter.tab)
    if (filter.department) params.append('department', filter.department)
    if (filter.pinned) params.append('pinned', 'true')
    if (debouncedSearch) params.append('search', debouncedSearch)
    return `/api/ideas?${params}`
  }, [page, limit, filter, debouncedSearch])

  // Fetch ideas with SWR
  const { data: res, error, isLoading, isValidating, mutate: refresh } = useAuthedSWR(swrKey)
  const ideas = Array.isArray(res?.data) ? res.data : []
  const departments = res?.departments || []
  const paginationData = res?.pagination || { total: 0, pages: 1 }

  // Mutations
  const voteMutation = useApiMutation({
    method: 'POST',
    onError: (msg) => toast.error(msg || 'Failed to vote'),
  })

  const pinMutation = useApiMutation({
    method: 'PUT',
    onError: (msg) => toast.error(msg || 'Failed to pin idea'),
  })

  const deleteMutation = useApiMutation({
    method: 'DELETE',
    onError: (msg) => toast.error(msg || 'Failed to delete idea'),
  })

  const handleIdeaCreated = () => {
    setShowCreateModal(false)
    toast.success('Idea submitted successfully!')
    refresh()
  }

  const handleVote = async (ideaId, type) => {
    const result = await voteMutation.execute(`/api/ideas/${ideaId}/vote`, { type })
    if (result?.success) {
      refresh(prev => ({
        ...prev,
        data: prev?.data?.map(idea =>
          idea._id === ideaId
            ? { ...idea, likes: result.data.likes, dislikes: result.data.dislikes, userVote: result.data.userVote }
            : idea
        )
      }), false)
    }
  }

  const handlePin = async (ideaId) => {
    const result = await pinMutation.execute(`/api/ideas/${ideaId}`, { action: 'pin' })
    if (result?.success) {
      toast.success(result.data.isPinned ? 'Idea pinned!' : 'Idea unpinned')
      refresh()
    }
  }

  const handleDelete = async (ideaId) => {
    if (!confirm('Are you sure you want to delete this idea?')) return
    const result = await deleteMutation.execute(`/api/ideas/${ideaId}`, null, { method: 'DELETE' })
    if (result?.success) {
      toast.success('Idea deleted')
      refresh()
    }
  }

  // Stats
  const myIdeas = ideas.filter(i => i.isOwner)
  const pinnedIdeas = ideas.filter(i => i.isPinned)
  const totalVotes = ideas.reduce((sum, i) => sum + (i.likes || 0), 0)

  const isAdmin = user?.role === 'admin' || user?.role === 'hr' || user?.role === 'department_head'

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <HiOutlineLightBulb className="w-7 h-7 text-yellow-500" />
            Ideas Sandbox
          </h1>
          <p className="text-gray-600 mt-1 flex items-center gap-2">
            Share your innovative ideas with the team
            <BackgroundRefreshIndicator isValidating={isValidating} />
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-white text-black border border-gray-300 rounded-lg font-medium hover:bg-blue-600 hover:text-black hover:border-blue-600 transition-colors"
        >
          <HiOutlinePlus className="w-5 h-5" />
          New Idea
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <HiOutlineLightBulb className="w-5 h-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{ideas.length}</p>
              <p className="text-sm text-gray-500">Total Ideas</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <HiOutlineUserCircle className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{myIdeas.length}</p>
              <p className="text-sm text-gray-500">My Ideas</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-lg">
              <FaThumbtack className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{pinnedIdeas.length}</p>
              <p className="text-sm text-gray-500">Pinned</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <HiOutlineHandThumbUp className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{totalVotes}</p>
              <p className="text-sm text-gray-500">Total Votes</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Search */}
          <div className="input-with-icon flex-1">
            <HiOutlineMagnifyingGlass className="input-icon w-5 h-5" />
            <input
              type="text"
              placeholder="Search ideas..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input input-search"
            />
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <div className="flex bg-white border border-gray-300 rounded-lg overflow-hidden">
              <button
                onClick={() => setFilter(prev => ({ ...prev, tab: 'all' }))}
                className={`px-4 py-2.5 text-sm font-medium transition-colors ${filter.tab === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-900 hover:bg-gray-50'
                  }`}
              >
                All Ideas
              </button>
              <button
                onClick={() => setFilter(prev => ({ ...prev, tab: 'my' }))}
                className={`px-4 py-2.5 text-sm font-medium transition-colors ${filter.tab === 'my'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-900 hover:bg-gray-50'
                  }`}
              >
                My Ideas
              </button>
            </div>

            <button
              onClick={() => setFilter(prev => ({ ...prev, pinned: !prev.pinned }))}
              className={`px-4 py-2.5 border rounded-lg flex items-center gap-2 transition-colors ${filter.pinned
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'border-gray-300 bg-white text-gray-900 hover:bg-gray-50'
                }`}
            >
              <HiOutlineFunnel className="w-4 h-4" />
              Filters
            </button>
          </div>
        </div>
      </div>

      {/* Ideas List */}
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-3">
          {filter.tab === 'my' ? 'My Ideas' : 'All Ideas'}
        </h2>

        {error ? (
          <DataErrorState message="Failed to load ideas" onRetry={() => refresh()} />
        ) : isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-white rounded-xl p-4 animate-pulse shadow-sm border border-gray-100">
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-3"></div>
                <div className="h-3 bg-gray-200 rounded w-1/2 mb-2"></div>
                <div className="h-3 bg-gray-200 rounded w-2/3"></div>
              </div>
            ))}
          </div>
        ) : ideas.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl shadow-sm border border-gray-100">
            <HiOutlineLightBulb className="w-16 h-16 mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-800 mb-2">
              No ideas found
            </h3>
            <p className="text-gray-500 mb-4">
              {searchQuery ? 'Try adjusting your search' : 'Be the first to share an innovative idea!'}
            </p>
            <Button
              onPress={() => setShowCreateModal(true)}
              color="primary"
              startContent={<HiOutlinePlus className="w-5 h-5" />}
            >
              Share an Idea
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {ideas.map(idea => (
              <IdeaCard
                key={idea._id}
                idea={idea}
                onVote={handleVote}
                onPin={handlePin}
                onDelete={handleDelete}
                isAdmin={isAdmin}
                onCommentAdded={(ideaId, newCount) => {
                  refresh(prev => ({
                    ...prev,
                    data: prev?.data?.map(i =>
                      i._id === ideaId ? { ...i, commentsCount: newCount } : i
                    )
                  }), false)
                }}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {paginationData.pages > 1 && (
          <div className="flex justify-center items-center gap-2 mt-6">
            <button
              onClick={() => setPage(p => p - 1)}
              disabled={page === 1}
              className="p-2 rounded-lg border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
            >
              <HiOutlineChevronLeft className="w-5 h-5 text-gray-600" />
            </button>
            <span className="text-sm text-gray-600">
              Page {page} of {paginationData.pages}
            </span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page === paginationData.pages}
              className="p-2 rounded-lg border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
            >
              <HiOutlineChevronRight className="w-5 h-5 text-gray-600" />
            </button>
          </div>
        )}
      </div>

      {/* Create Idea Modal */}
      {showCreateModal && (
        <CreateIdeaModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSuccess={handleIdeaCreated}
        />
      )}
    </div>
  )
}

