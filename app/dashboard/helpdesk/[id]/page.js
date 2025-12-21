'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { FaArrowLeft, FaUser, FaPaperPlane, FaClock, FaTag, FaExclamationCircle, FaCheckCircle } from 'react-icons/fa'
import { getCurrentUser, getEmployeeId } from '@/utils/userHelper'

export default function TicketDetailPage() {
  const params = useParams()
  const router = useRouter()
  const [ticket, setTicket] = useState(null)
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [newComment, setNewComment] = useState('')
  const [sending, setSending] = useState(false)
  const commentsEndRef = useRef(null)

  useEffect(() => {
    const parsedUser = getCurrentUser()
    if (parsedUser) {
      setUser(parsedUser)
      fetchTicket()
    }
  }, [params.id])

  useEffect(() => {
    scrollToBottom()
  }, [ticket?.comments])

  const scrollToBottom = () => {
    commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const fetchTicket = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/helpdesk/${params.id}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()
      if (data.success) {
        setTicket(data.data)
      } else {
        toast.error(data.message)
        router.push('/dashboard/helpdesk')
      }
    } catch (error) {
      console.error('Fetch ticket error:', error)
      toast.error('Failed to fetch ticket')
    } finally {
      setLoading(false)
    }
  }

  const handleStatusChange = async (newStatus) => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/helpdesk/${params.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
      })

      const data = await response.json()
      if (data.success) {
        toast.success(`Status updated to ${newStatus}`)
        setTicket(prev => ({ ...prev, status: newStatus }))
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      console.error('Update status error:', error)
      toast.error('Failed to update status')
    }
  }

  const handleAddComment = async (e) => {
    e.preventDefault()
    if (!newComment.trim()) return

    setSending(true)
    try {
      const token = localStorage.getItem('token')
      const empId = getEmployeeId(user)
      
      const response = await fetch(`/api/helpdesk/${params.id}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          comment: newComment,
          commentedBy: empId
        })
      })

      const data = await response.json()
      if (data.success) {
        setNewComment('')
        fetchTicket() // Refresh to get new comment
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      console.error('Add comment error:', error)
      toast.error('Failed to add comment')
    } finally {
      setSending(false)
    }
  }

  const canManageTicket = user && ['admin', 'hr', 'manager', 'department_head'].includes(user.role)

  if (loading) {
    return (
      <div className="p-6 flex justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    )
  }

  if (!ticket) return null

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <button
        onClick={() => router.back()}
        className="flex items-center text-gray-600 hover:text-gray-900 mb-6"
      >
        <FaArrowLeft className="mr-2" /> Back to Tickets
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content - Ticket Info & Comments */}
        <div className="lg:col-span-2 space-y-6">
          {/* Ticket Header */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-800 mb-2">{ticket.subject}</h1>
                <div className="flex items-center gap-3 text-sm text-gray-500">
                  <span className="bg-gray-100 px-2 py-1 rounded font-mono">{ticket.ticketNumber}</span>
                  <span className="flex items-center gap-1">
                    <FaClock /> {new Date(ticket.createdAt).toLocaleString()}
                  </span>
                </div>
              </div>
              <span className={`px-3 py-1 rounded-full text-sm font-semibold capitalize ${
                ticket.status === 'open' ? 'bg-blue-100 text-blue-800' :
                ticket.status === 'in-progress' ? 'bg-yellow-100 text-yellow-800' :
                ticket.status === 'resolved' ? 'bg-green-100 text-green-800' :
                'bg-gray-100 text-gray-800'
              }`}>
                {ticket.status}
              </span>
            </div>
            
            <div className="prose max-w-none text-gray-700 mb-6">
              <p>{ticket.description}</p>
            </div>

            <div className="flex items-center gap-4 pt-4 border-t border-gray-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-600">
                  <FaUser size={14} />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {ticket.createdBy?.firstName} {ticket.createdBy?.lastName}
                  </p>
                  <p className="text-xs text-gray-500">Reporter</p>
                </div>
              </div>
            </div>
          </div>

          {/* Comments Section */}
          <div className="bg-white rounded-lg shadow-md flex flex-col h-[500px]">
            <div className="p-4 border-b border-gray-200">
              <h3 className="font-semibold text-gray-800">Discussion</h3>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
              {ticket.comments?.length === 0 && (
                <p className="text-center text-gray-500 italic my-4">No comments yet.</p>
              )}
              
              {ticket.comments?.map((comment, index) => {
                const isMe = comment.commentedBy?._id === getEmployeeId(user) || comment.commentedBy === getEmployeeId(user)
                return (
                  <div key={index} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-lg p-3 ${
                      isMe ? 'bg-primary-600 text-white' : 'bg-white border border-gray-200 text-gray-800'
                    }`}>
                      <div className="flex justify-between items-center gap-4 mb-1">
                        <span className={`text-xs font-bold ${isMe ? 'text-primary-100' : 'text-gray-600'}`}>
                          {comment.commentedBy?.firstName} {comment.commentedBy?.lastName}
                        </span>
                        <span className={`text-xs ${isMe ? 'text-primary-200' : 'text-gray-400'}`}>
                          {new Date(comment.commentedAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{comment.comment}</p>
                    </div>
                  </div>
                )
              })}
              <div ref={commentsEndRef} />
            </div>

            <div className="p-4 bg-white border-t border-gray-200">
              <form onSubmit={handleAddComment} className="flex gap-2">
                <input
                  type="text"
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Type your reply..."
                  className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  disabled={sending}
                />
                <button
                  type="submit"
                  disabled={sending || !newComment.trim()}
                  className="bg-primary-600 text-white p-2 rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
                >
                  <FaPaperPlane />
                </button>
              </form>
            </div>
          </div>
        </div>

        {/* Sidebar - Meta Info & Actions */}
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="font-semibold text-gray-800 mb-4">Ticket Details</h3>
            
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-500 uppercase font-bold">Category</label>
                <div className="flex items-center gap-2 mt-1">
                  <FaTag className="text-gray-400" />
                  <span className="capitalize">{ticket.category}</span>
                </div>
              </div>
              
              <div>
                <label className="text-xs text-gray-500 uppercase font-bold">Priority</label>
                <div className="flex items-center gap-2 mt-1">
                  <FaExclamationCircle className={`
                    ${ticket.priority === 'high' || ticket.priority === 'urgent' ? 'text-red-500' : 
                      ticket.priority === 'medium' ? 'text-yellow-500' : 'text-green-500'}
                  `} />
                  <span className="capitalize">{ticket.priority}</span>
                </div>
              </div>

              {canManageTicket && (
                <div className="pt-4 border-t border-gray-100 mt-4">
                  <label className="text-xs text-gray-500 uppercase font-bold block mb-2">Update Status</label>
                  <select
                    value={ticket.status}
                    onChange={(e) => handleStatusChange(e.target.value)}
                    className="w-full border border-gray-300 rounded-md p-2 text-sm"
                  >
                    <option value="open">Open</option>
                    <option value="in-progress">In Progress</option>
                    <option value="resolved">Resolved</option>
                    <option value="closed">Closed</option>
                  </select>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
