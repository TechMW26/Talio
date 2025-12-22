'use client'

import { useState } from 'react'
import { 
  HiOutlineChatBubbleLeft,
  HiOutlineHandThumbUp,
  HiOutlineHandThumbDown,
  HiOutlineTrash,
  HiOutlineEye,
  HiOutlineEyeSlash,
  HiOutlineChevronDown,
  HiOutlineChevronUp
} from 'react-icons/hi2'
import { FaThumbtack, FaUserSecret, FaUser, FaSpinner, FaPaperPlane } from 'react-icons/fa'
import toast from 'react-hot-toast'

const CATEGORIES = {
  'process_improvement': { label: 'Process', icon: '⚙️' },
  'cost_reduction': { label: 'Cost', icon: '💰' },
  'technology': { label: 'Tech', icon: '💻' },
  'workplace': { label: 'Workplace', icon: '🏢' },
  'customer_service': { label: 'Service', icon: '🤝' },
  'product': { label: 'Product', icon: '📦' },
  'safety': { label: 'Safety', icon: '🛡️' },
  'environment': { label: 'Environment', icon: '🌱' },
  'training': { label: 'Training', icon: '📚' },
  'other': { label: 'Other', icon: '💡' }
}

const STATUS_STYLES = {
  'submitted': 'bg-blue-100 text-blue-800',
  'under_review': 'bg-yellow-100 text-yellow-800',
  'approved': 'bg-green-100 text-green-800',
  'rejected': 'bg-red-100 text-red-800',
  'implemented': 'bg-purple-100 text-purple-800',
  'on_hold': 'bg-gray-100 text-gray-800',
  'cancelled': 'bg-red-50 text-red-600'
}

const STATUS_LABELS = {
  'submitted': 'New',
  'under_review': 'Under Review',
  'approved': 'Approved',
  'rejected': 'Rejected',
  'implemented': 'Implemented',
  'on_hold': 'On Hold',
  'cancelled': 'Cancelled'
}

export default function IdeaCard({ idea, onVote, onPin, onDelete, isAdmin }) {
  const [expanded, setExpanded] = useState(false)
  const [comments, setComments] = useState([])
  const [loadingComments, setLoadingComments] = useState(false)
  const [newComment, setNewComment] = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)

  const categoryInfo = CATEGORIES[idea.category] || CATEGORIES.other
  const statusStyle = STATUS_STYLES[idea.status] || STATUS_STYLES.submitted
  const statusLabel = STATUS_LABELS[idea.status] || 'New'

  const formatDate = (date) => {
    if (!date) return ''
    const d = new Date(date)
    const now = new Date()
    const diff = now - d
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    
    if (days === 0) return 'Today'
    if (days === 1) return 'Yesterday'
    if (days < 7) return `${days} days ago`
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`
    return d.toLocaleDateString()
  }

  const loadComments = async () => {
    if (comments.length > 0 || loadingComments) return
    
    setLoadingComments(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/ideas/${idea._id}/comments`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (data.success) {
        setComments(data.data || [])
      }
    } catch (error) {
      console.error('Error loading comments:', error)
    } finally {
      setLoadingComments(false)
    }
  }

  const handleExpand = () => {
    if (!expanded) {
      loadComments()
    }
    setExpanded(!expanded)
  }

  const handleAddComment = async () => {
    if (!newComment.trim()) return
    
    setSubmittingComment(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/ideas/${idea._id}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ content: newComment })
      })

      const data = await res.json()
      if (data.success) {
        setComments(prev => [...prev, data.data])
        setNewComment('')
        toast.success('Comment added!')
      } else {
        toast.error(data.message || 'Failed to add comment')
      }
    } catch (error) {
      console.error('Error adding comment:', error)
      toast.error('Failed to add comment')
    } finally {
      setSubmittingComment(false)
    }
  }

  const voteScore = (idea.likes || 0) - (idea.dislikes || 0)

  return (
    <div className={`bg-white rounded-xl shadow-sm border transition-all ${
      idea.isPinned 
        ? 'border-amber-300 ring-1 ring-amber-200' 
        : 'border-gray-100 hover:shadow-md'
    }`}>
      {/* Pinned Badge */}
      {idea.isPinned && (
        <div className="bg-amber-50 px-4 py-2 rounded-t-xl border-b border-amber-200 flex items-center gap-2">
          <FaThumbtack className="w-3 h-3 text-amber-600" />
          <span className="text-xs font-medium text-amber-700">Pinned</span>
        </div>
      )}
      
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            <span className="text-xl flex-shrink-0">{categoryInfo.icon}</span>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-gray-800 line-clamp-2 mb-1">
                {idea.title}
              </h3>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusStyle}`}>
                  {statusLabel}
                </span>
                <span className="text-xs text-gray-500">
                  {formatDate(idea.createdAt)}
                </span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1">
            {isAdmin && (
              <button
                onClick={() => onPin(idea._id)}
                className={`p-1.5 rounded-lg transition-colors ${
                  idea.isPinned
                    ? 'text-amber-600 bg-amber-50'
                    : 'text-gray-400 hover:text-amber-600 hover:bg-amber-50'
                }`}
                title={idea.isPinned ? 'Unpin' : 'Pin'}
              >
                <FaThumbtack className="w-3.5 h-3.5" />
              </button>
            )}
            {idea.isOwner && (
              <button
                onClick={() => onDelete(idea._id)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                title="Delete"
              >
                <HiOutlineTrash className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Description */}
        <p className={`text-gray-600 text-sm mb-4 ${expanded ? '' : 'line-clamp-2'}`}>
          {idea.description}
        </p>

        {/* Author */}
        <div className="flex items-center gap-2 mb-3 pb-3 border-b border-gray-100">
          {idea.isAnonymous ? (
            <>
              <div className="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center">
                <FaUserSecret className="w-3 h-3 text-gray-500" />
              </div>
              <span className="text-sm text-gray-500 italic">Anonymous</span>
            </>
          ) : (
            <>
              <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center overflow-hidden">
                {idea.author?.profilePicture ? (
                  <img src={idea.author.profilePicture} alt="" className="w-full h-full object-cover" />
                ) : (
                  <FaUser className="w-3 h-3 text-blue-600" />
                )}
              </div>
              <span className="text-sm text-gray-700">
                {idea.author?.name || 'Unknown'}
              </span>
              {idea.author?.department && (
                <span className="text-xs text-gray-400">• {idea.author.department}</span>
              )}
            </>
          )}
        </div>

        {/* Stats and Actions */}
        <div className="flex items-center justify-between">
          {/* Vote buttons */}
          <div className="flex items-center gap-1 bg-gray-50 rounded-full px-1 py-0.5">
            <button
              onClick={() => onVote(idea._id, idea.userVote === 'upvote' ? 'remove' : 'upvote')}
              className={`p-1.5 rounded-full transition-colors ${
                idea.userVote === 'upvote'
                  ? 'bg-green-100 text-green-600'
                  : 'hover:bg-gray-200 text-gray-500'
              }`}
            >
              <HiOutlineHandThumbUp className="w-4 h-4" />
            </button>
            <span className={`text-sm font-medium min-w-[20px] text-center ${
              voteScore > 0 ? 'text-green-600' : voteScore < 0 ? 'text-red-600' : 'text-gray-600'
            }`}>
              {voteScore}
            </span>
            <button
              onClick={() => onVote(idea._id, idea.userVote === 'downvote' ? 'remove' : 'downvote')}
              className={`p-1.5 rounded-full transition-colors ${
                idea.userVote === 'downvote'
                  ? 'bg-red-100 text-red-600'
                  : 'hover:bg-gray-200 text-gray-500'
              }`}
            >
              <HiOutlineHandThumbDown className="w-4 h-4" />
            </button>
          </div>

          {/* Comments and Expand */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleExpand}
              className="flex items-center gap-1 text-gray-500 hover:text-blue-600 transition-colors"
            >
              <HiOutlineChatBubbleLeft className="w-4 h-4" />
              <span className="text-sm">{idea.commentsCount || 0}</span>
            </button>

            <button
              onClick={handleExpand}
              className="p-1 rounded-lg hover:bg-gray-100 transition-colors"
            >
              {expanded ? (
                <HiOutlineChevronUp className="w-4 h-4 text-gray-400" />
              ) : (
                <HiOutlineChevronDown className="w-4 h-4 text-gray-400" />
              )}
            </button>
          </div>
        </div>

        {/* Expanded Content - Comments */}
        {expanded && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <h4 className="font-medium text-gray-800 mb-3 text-sm">
              Comments ({comments.length})
            </h4>
            
            {/* Comment List */}
            <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
              {loadingComments ? (
                <div className="flex justify-center py-4">
                  <FaSpinner className="w-5 h-5 animate-spin text-gray-400" />
                </div>
              ) : comments.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-3">
                  No comments yet
                </p>
              ) : (
                comments.map((comment, idx) => (
                  <div key={idx} className="flex gap-2 bg-gray-50 rounded-lg p-2">
                    <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                      {comment.isAnonymous ? (
                        <FaUserSecret className="w-3 h-3 text-gray-500" />
                      ) : comment.author?.profilePicture ? (
                        <img src={comment.author.profilePicture} alt="" className="w-full h-full object-cover rounded-full" />
                      ) : (
                        <FaUser className="w-3 h-3 text-blue-600" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-medium text-gray-800">
                          {comment.isAnonymous ? 'Anonymous' : 
                            comment.author ? `${comment.author.firstName} ${comment.author.lastName}` : 'Unknown'}
                        </span>
                        <span className="text-xs text-gray-400">
                          {formatDate(comment.createdAt)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600">{comment.content}</p>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Add Comment */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment..."
                className="flex-1 px-3 py-2 bg-white text-black border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-600 focus:border-blue-600 placeholder-gray-500"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleAddComment()
                  }
                }}
              />
              <button
                onClick={handleAddComment}
                disabled={submittingComment || !newComment.trim()}
                className="px-3 py-2 bg-blue-600 text-black rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submittingComment ? (
                  <FaSpinner className="w-4 h-4 animate-spin" />
                ) : (
                  <FaPaperPlane className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
