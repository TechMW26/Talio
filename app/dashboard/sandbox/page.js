'use client'

import { useState, useEffect, useCallback } from 'react'
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
import { FaSpinner, FaThumbtack, FaUserSecret, FaPaperPlane } from 'react-icons/fa'
import toast from '@/utils/toast'
import CreateIdeaModal from './components/CreateIdeaModal'
import IdeaCard from './components/IdeaCard'

export default function SandboxPage() {
  const [ideas, setIdeas] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [filter, setFilter] = useState({
    tab: 'all',
    department: '',
    pinned: false
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [departments, setDepartments] = useState([])
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    pages: 1
  })
  const [user, setUser] = useState(null)

  // Load user
  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      setUser(JSON.parse(userData))
    }
  }, [])

  const fetchIdeas = useCallback(async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('token')
      
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString()
      })

      if (filter.tab !== 'all') params.append('tab', filter.tab)
      if (filter.department) params.append('department', filter.department)
      if (filter.pinned) params.append('pinned', 'true')
      if (searchQuery) params.append('search', searchQuery)

      const response = await fetch(`/api/ideas?${params}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      const data = await response.json()
      if (data.success) {
        setIdeas(Array.isArray(data.data) ? data.data : [])
        if (data.departments) {
          setDepartments(data.departments)
        }
        if (data.pagination) {
          setPagination(prev => ({
            ...prev,
            total: data.pagination.total,
            pages: data.pagination.pages
          }))
        }
      } else {
        toast.error(data.message || 'Failed to fetch ideas')
        setIdeas([])
      }
    } catch (error) {
      console.error('Error fetching ideas:', error)
      toast.error('Failed to load ideas')
      setIdeas([])
    } finally {
      setLoading(false)
    }
  }, [filter, pagination.page, pagination.limit, searchQuery])

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchIdeas()
    }, 300)
    return () => clearTimeout(timer)
  }, [fetchIdeas])

  const handleIdeaCreated = (newIdea) => {
    setShowCreateModal(false)
    toast.success('Idea submitted successfully!')
    fetchIdeas()
  }

  const handleVote = async (ideaId, type) => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/ideas/${ideaId}/vote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ type })
      })

      const data = await res.json()
      if (data.success) {
        setIdeas(prev => prev.map(idea => 
          idea._id === ideaId 
            ? { ...idea, likes: data.data.likes, dislikes: data.data.dislikes, userVote: data.data.userVote }
            : idea
        ))
      } else {
        toast.error(data.message || 'Failed to vote')
      }
    } catch (error) {
      console.error('Error voting:', error)
      toast.error('Failed to vote')
    }
  }

  const handlePin = async (ideaId) => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/ideas/${ideaId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ action: 'pin' })
      })

      const data = await res.json()
      if (data.success) {
        toast.success(data.data.isPinned ? 'Idea pinned!' : 'Idea unpinned')
        fetchIdeas()
      }
    } catch (error) {
      console.error('Error pinning:', error)
      toast.error('Failed to pin idea')
    }
  }

  const handleDelete = async (ideaId) => {
    if (!confirm('Are you sure you want to delete this idea?')) return
    
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/ideas/${ideaId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })

      const data = await res.json()
      if (data.success) {
        toast.success('Idea deleted')
        fetchIdeas()
      } else {
        toast.error(data.message || 'Failed to delete')
      }
    } catch (error) {
      console.error('Error deleting:', error)
      toast.error('Failed to delete idea')
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
          <p className="text-gray-600 mt-1">
            Share your innovative ideas with the team
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
          <div className="relative flex-1">
            <HiOutlineMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search ideas..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg bg-white text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <div className="flex bg-white border border-gray-300 rounded-lg overflow-hidden">
              <button
                onClick={() => setFilter(prev => ({ ...prev, tab: 'all' }))}
                className={`px-4 py-2.5 text-sm font-medium transition-colors ${
                  filter.tab === 'all'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-900 hover:bg-gray-50'
                }`}
              >
                All Ideas
              </button>
              <button
                onClick={() => setFilter(prev => ({ ...prev, tab: 'my' }))}
                className={`px-4 py-2.5 text-sm font-medium transition-colors ${
                  filter.tab === 'my'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-900 hover:bg-gray-50'
                }`}
              >
                My Ideas
              </button>
            </div>

            <button
              onClick={() => setFilter(prev => ({ ...prev, pinned: !prev.pinned }))}
              className={`px-4 py-2.5 border rounded-lg flex items-center gap-2 transition-colors ${
                filter.pinned 
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
        
        {loading ? (
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
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn-primary inline-flex items-center gap-2"
            >
              <HiOutlinePlus className="w-5 h-5" />
              Share an Idea
            </button>
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
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="flex justify-center items-center gap-2 mt-6">
            <button
              onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
              disabled={pagination.page === 1}
              className="p-2 rounded-lg border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
            >
              <HiOutlineChevronLeft className="w-5 h-5 text-gray-600" />
            </button>
            <span className="text-sm text-gray-600">
              Page {pagination.page} of {pagination.pages}
            </span>
            <button
              onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
              disabled={pagination.page === pagination.pages}
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

