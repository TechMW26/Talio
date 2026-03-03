'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { FaArrowLeft, FaUser, FaPaperPlane, FaClock, FaTag, FaExclamationCircle, FaCheckCircle } from 'react-icons/fa'
import { getCurrentUser, getEmployeeId } from '@/utils/userHelper'
import { Select, SelectItem, Skeleton, Card, CardBody } from '@heroui/react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'

export default function TicketDetailPage() {
  const params = useParams()
  const router = useRouter()
  const [newComment, setNewComment] = useState('')
  const commentsEndRef = useRef(null)

  const user = useMemo(() => getCurrentUser(), [])

  const { data: res, error, isLoading, isValidating, mutate: refresh } = useAuthedSWR(params.id ? `/api/helpdesk/${params.id}` : null)
  const ticket = res?.data || null

  useEffect(() => {
    scrollToBottom()
  }, [ticket?.comments])

  const scrollToBottom = () => {
    commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const statusMutation = useApiMutation({
    method: 'PUT',
    invalidateKeys: [`/api/helpdesk/${params.id}`],
    onSuccess: () => toast.success('Status updated'),
    onError: (msg) => toast.error(msg || 'Failed to update status'),
  })

  const handleStatusChange = async (newStatus) => {
    await statusMutation.execute(`/api/helpdesk/${params.id}`, { status: newStatus })
  }

  const commentMutation = useApiMutation({
    method: 'POST',
    invalidateKeys: [`/api/helpdesk/${params.id}`],
    onSuccess: () => setNewComment(''),
    onError: (msg) => toast.error(msg || 'Failed to add comment'),
  })

  const handleAddComment = async (e) => {
    e.preventDefault()
    if (!newComment.trim()) return
    const empId = getEmployeeId(user)
    await commentMutation.execute(`/api/helpdesk/${params.id}/comments`, {
      comment: newComment,
      commentedBy: empId
    })
  }

  const canManageTicket = user && ['admin', 'hr', 'manager', 'department_head'].includes(user.role)

  if (isLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="space-y-6">
          <Skeleton className="h-8 w-48 rounded-lg" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <Skeleton className="h-48 rounded-xl" />
              <Skeleton className="h-[500px] rounded-xl" />
            </div>
            <div className="space-y-6">
              <Skeleton className="h-64 rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <DataErrorState message="Failed to load ticket details" onRetry={() => refresh()} />
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
      <BackgroundRefreshIndicator isValidating={isValidating && !isLoading} position="inline" />

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
              <span className={`px-3 py-1 rounded-full text-sm font-semibold capitalize ${ticket.status === 'open' ? 'bg-blue-100 text-blue-800' :
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
                const commentBy = comment?.commentedBy || comment?.author
                const commentText = comment?.comment ?? comment?.content ?? ''
                const commentAt = comment?.commentedAt || comment?.createdAt
                const currentEmployeeId = getEmployeeId(user)
                const commenterEmployeeId = commentBy?._id || commentBy
                const isMe = commenterEmployeeId === currentEmployeeId
                return (
                  <div key={index} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-lg p-3 ${isMe ? 'bg-primary-600 text-white' : 'bg-white border border-gray-200 text-gray-800'
                      }`}>
                      <div className="flex justify-between items-center gap-4 mb-1">
                        <span className={`text-xs font-bold ${isMe ? 'text-primary-100' : 'text-gray-600'}`}>
                          {commentBy?.firstName} {commentBy?.lastName}
                        </span>
                        <span className={`text-xs ${isMe ? 'text-primary-200' : 'text-gray-400'}`}>
                          {commentAt ? new Date(commentAt).toLocaleString() : ''}
                        </span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{commentText}</p>
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
                  disabled={commentMutation.isLoading}
                />
                <button
                  type="submit"
                  disabled={commentMutation.isLoading || !newComment.trim()}
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
                  <Select
                    selectedKeys={[ticket.status]}
                    onSelectionChange={(keys) => handleStatusChange(Array.from(keys)[0] || ticket.status)}
                    size="sm"
                    aria-label="Update status"
                  >
                    <SelectItem key="open">Open</SelectItem>
                    <SelectItem key="in-progress">In Progress</SelectItem>
                    <SelectItem key="resolved">Resolved</SelectItem>
                    <SelectItem key="closed">Closed</SelectItem>
                  </Select>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
