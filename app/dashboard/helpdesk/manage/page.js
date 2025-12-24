'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { 
  FaTicketAlt, FaCheckCircle, FaClock, FaExclamationCircle, 
  FaUser, FaArrowRight, FaComment, FaTimes, FaChevronDown
} from 'react-icons/fa'
import { getCurrentUser } from '@/utils/userHelper'
import ModalPortal from '@/components/ui/ModalPortal'

export default function HelpdeskManagePage() {
  const router = useRouter()
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [selectedTicket, setSelectedTicket] = useState(null)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [newComment, setNewComment] = useState('')
  const [newStatus, setNewStatus] = useState('')
  const [employees, setEmployees] = useState([])
  const [assignTo, setAssignTo] = useState('')
  const [filter, setFilter] = useState('all') // all, open, in-progress, resolved

  useEffect(() => {
    const parsedUser = getCurrentUser()
    if (parsedUser) {
      setUser(parsedUser)
      // Check if user has permission to view this page
      if (!['admin', 'hr', 'manager', 'department_head', 'super_admin'].includes(parsedUser.role)) {
        toast.error('You do not have permission to access this page')
        router.push('/dashboard/helpdesk')
        return
      }
      fetchAllTickets()
      fetchEmployees()
    } else {
      toast.error('Please login to access this page')
      router.push('/login')
    }
  }, [])

  const fetchAllTickets = async () => {
    try {
      const token = localStorage.getItem('token')
      // Fetch all tickets (no employeeId filter for admins)
      const response = await fetch('/api/helpdesk', {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()
      if (data.success) {
        setTickets(data.data || [])
      }
    } catch (error) {
      console.error('Fetch tickets error:', error)
      toast.error('Failed to fetch tickets')
    } finally {
      setLoading(false)
    }
  }

  const fetchEmployees = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/employees?limit=1000', {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      const data = await response.json()
      if (data.success) {
        const empList = Array.isArray(data.data) ? data.data : (data.data.employees || [])
        setEmployees(empList)
      }
    } catch (error) {
      console.error('Fetch employees error:', error)
    }
  }

  const handleViewTicket = (ticket) => {
    setSelectedTicket(ticket)
    setNewStatus(ticket.status)
    setAssignTo(ticket.assignedTo?._id || '')
    setShowDetailModal(true)
  }

  const handleUpdateTicket = async () => {
    if (!selectedTicket) return

    try {
      const token = localStorage.getItem('token')
      const updateData = {
        status: newStatus
      }

      // Add date fields based on status
      if (newStatus === 'resolved' && selectedTicket.status !== 'resolved') {
        updateData.resolvedDate = new Date()
      }
      if (newStatus === 'closed' && selectedTicket.status !== 'closed') {
        updateData.closedDate = new Date()
      }
      if (assignTo) {
        updateData.assignedTo = assignTo
        if (!selectedTicket.assignedTo) {
          updateData.assignedDate = new Date()
        }
      }

      const response = await fetch(`/api/helpdesk/${selectedTicket._id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(updateData)
      })

      const data = await response.json()
      if (data.success) {
        toast.success('Ticket updated successfully')
        fetchAllTickets()
        setShowDetailModal(false)
        setSelectedTicket(null)
      } else {
        toast.error(data.message || 'Failed to update ticket')
      }
    } catch (error) {
      console.error('Update ticket error:', error)
      toast.error('Failed to update ticket')
    }
  }

  const handleAddComment = async () => {
    if (!selectedTicket || !newComment.trim()) return

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/helpdesk/${selectedTicket._id}/comment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          comment: newComment,
          isInternal: false
        })
      })

      const data = await response.json()
      if (data.success) {
        toast.success('Comment added')
        setNewComment('')
        // Refresh ticket details
        const ticketRes = await fetch(`/api/helpdesk/${selectedTicket._id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        const ticketData = await ticketRes.json()
        if (ticketData.success) {
          setSelectedTicket(ticketData.data)
        }
        fetchAllTickets()
      } else {
        toast.error(data.message || 'Failed to add comment')
      }
    } catch (error) {
      console.error('Add comment error:', error)
      toast.error('Failed to add comment')
    }
  }

  const filteredTickets = tickets.filter(t => {
    if (filter === 'all') return true
    return t.status === filter
  })

  const stats = [
    {
      label: 'Total Tickets',
      value: tickets.length,
      icon: FaTicketAlt,
      bgColor: 'bg-blue-100',
      iconColor: 'text-blue-600'
    },
    {
      label: 'Open',
      value: tickets.filter(t => t.status === 'open').length,
      icon: FaClock,
      bgColor: 'bg-yellow-100',
      iconColor: 'text-yellow-600',
      filter: 'open'
    },
    {
      label: 'In Progress',
      value: tickets.filter(t => t.status === 'in-progress').length,
      icon: FaExclamationCircle,
      bgColor: 'bg-orange-100',
      iconColor: 'text-orange-600',
      filter: 'in-progress'
    },
    {
      label: 'Resolved',
      value: tickets.filter(t => t.status === 'resolved').length,
      icon: FaCheckCircle,
      bgColor: 'bg-green-100',
      iconColor: 'text-green-600',
      filter: 'resolved'
    }
  ]

  const getStatusColor = (status) => {
    switch (status) {
      case 'open': return 'bg-yellow-100 text-yellow-800'
      case 'in-progress': return 'bg-blue-100 text-blue-800'
      case 'resolved': return 'bg-green-100 text-green-800'
      case 'closed': return 'bg-gray-100 text-gray-800'
      case 'reopened': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'urgent': return 'bg-red-100 text-red-800'
      case 'high': return 'bg-orange-100 text-orange-800'
      case 'medium': return 'bg-yellow-100 text-yellow-800'
      case 'low': return 'bg-green-100 text-green-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Helpdesk Management</h1>
          <p className="text-sm text-gray-600 mt-1">Manage and respond to support tickets</p>
        </div>
        <button
          onClick={() => router.push('/dashboard/helpdesk')}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition-colors"
        >
          <FaTicketAlt className="w-4 h-4" />
          <span>My Tickets</span>
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, index) => (
          <div 
            key={index} 
            className={`bg-white rounded-xl p-4 shadow-sm border border-gray-100 cursor-pointer transition-all hover:shadow-md ${filter === stat.filter ? 'ring-2 ring-blue-500' : ''}`}
            onClick={() => setFilter(stat.filter || 'all')}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">{stat.label}</p>
                <p className="text-2xl sm:text-3xl font-bold text-gray-900">{stat.value}</p>
              </div>
              <div className={`p-3 rounded-xl ${stat.bgColor}`}>
                <stat.icon className={`w-5 h-5 sm:w-6 sm:h-6 ${stat.iconColor}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {['all', 'open', 'in-progress', 'resolved', 'closed'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg font-medium text-sm whitespace-nowrap transition-colors ${
              filter === f 
                ? 'bg-blue-600 text-white' 
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {f === 'all' ? 'All Tickets' : f.charAt(0).toUpperCase() + f.slice(1).replace('-', ' ')}
          </button>
        ))}
      </div>

      {/* Tickets Table */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-800">
            {filter === 'all' ? 'All Tickets' : `${filter.charAt(0).toUpperCase() + filter.slice(1).replace('-', ' ')} Tickets`}
            <span className="ml-2 text-sm font-normal text-gray-500">({filteredTickets.length})</span>
          </h2>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading tickets...</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Ticket #
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Subject
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Raised By
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Category
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Priority
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Assigned To
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredTickets.length === 0 ? (
                  <tr>
                    <td colSpan="9" className="px-6 py-8 text-center text-gray-500">
                      <FaTicketAlt className="mx-auto text-4xl text-gray-300 mb-3" />
                      <p className="text-lg font-medium">No tickets found</p>
                      <p className="text-sm">There are no tickets matching your filter</p>
                    </td>
                  </tr>
                ) : (
                  filteredTickets.map((ticket) => (
                    <tr key={ticket._id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-primary-600">
                        {ticket?.ticketNumber || 'N/A'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900 max-w-xs truncate">
                        {ticket?.subject || 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {ticket?.createdBy ? (
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
                              <FaUser className="w-3 h-3 text-gray-500" />
                            </div>
                            <span>{ticket.createdBy.firstName} {ticket.createdBy.lastName}</span>
                          </div>
                        ) : 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 capitalize">
                        {ticket?.category?.replace('-', ' ') || 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getPriorityColor(ticket?.priority)}`}>
                          {ticket?.priority || 'medium'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(ticket?.status)}`}>
                          {ticket?.status || 'open'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {ticket?.assignedTo ? (
                          `${ticket.assignedTo.firstName} ${ticket.assignedTo.lastName}`
                        ) : (
                          <span className="text-gray-400">Unassigned</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {ticket?.createdAt ? new Date(ticket.createdAt).toLocaleDateString() : 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button
                          onClick={() => handleViewTicket(ticket)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors text-sm font-medium"
                        >
                          <span>Manage</span>
                          <FaArrowRight className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Ticket Detail Modal */}
      <ModalPortal isOpen={showDetailModal}>
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowDetailModal(false)}>
          <div className="modal-backdrop" />
          <div className="modal-container modal-lg max-h-[90vh] overflow-y-auto">
            <div className="modal-header">
              <h2 className="modal-title">
                Ticket: {selectedTicket?.ticketNumber}
              </h2>
              <button onClick={() => setShowDetailModal(false)} className="modal-close-btn">
                <FaTimes className="w-5 h-5" />
              </button>
            </div>

            {selectedTicket && (
              <div className="modal-body space-y-6">
                {/* Ticket Info */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="font-semibold text-lg text-gray-900 mb-2">{selectedTicket.subject}</h3>
                  <p className="text-gray-600 mb-4">{selectedTicket.description}</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Category:</span>
                      <p className="font-medium capitalize">{selectedTicket.category?.replace('-', ' ')}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Priority:</span>
                      <p className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${getPriorityColor(selectedTicket.priority)}`}>
                        {selectedTicket.priority}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500">Raised By:</span>
                      <p className="font-medium">
                        {selectedTicket.createdBy?.firstName} {selectedTicket.createdBy?.lastName}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500">Created:</span>
                      <p className="font-medium">
                        {new Date(selectedTicket.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Status & Assignment */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Update Status
                    </label>
                    <select
                      value={newStatus}
                      onChange={(e) => setNewStatus(e.target.value)}
                      className="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 border p-2.5"
                    >
                      <option value="open">Open</option>
                      <option value="in-progress">In Progress</option>
                      <option value="resolved">Resolved</option>
                      <option value="closed">Closed</option>
                      <option value="reopened">Reopened</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Assign To
                    </label>
                    <select
                      value={assignTo}
                      onChange={(e) => setAssignTo(e.target.value)}
                      className="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 border p-2.5"
                    >
                      <option value="">Unassigned</option>
                      {employees.map(emp => (
                        <option key={emp._id} value={emp._id}>
                          {emp.firstName} {emp.lastName}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Comments Thread */}
                <div>
                  <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                    <FaComment className="text-gray-400" />
                    Comments ({selectedTicket.comments?.length || 0})
                  </h4>
                  <div className="space-y-3 max-h-48 overflow-y-auto mb-4">
                    {selectedTicket.comments?.length === 0 ? (
                      <p className="text-gray-500 text-sm text-center py-4">No comments yet</p>
                    ) : (
                      selectedTicket.comments?.map((comment, idx) => (
                        <div key={idx} className="bg-gray-50 rounded-lg p-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium text-sm">
                              {comment.commentedBy?.firstName || 'User'} {comment.commentedBy?.lastName || ''}
                            </span>
                            <span className="text-xs text-gray-500">
                              {new Date(comment.commentedAt).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-gray-700 text-sm">{comment.comment}</p>
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
                      className="flex-1 rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 border p-2.5"
                      onKeyPress={(e) => e.key === 'Enter' && handleAddComment()}
                    />
                    <button
                      onClick={handleAddComment}
                      disabled={!newComment.trim()}
                      className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="modal-footer">
              <button
                onClick={() => setShowDetailModal(false)}
                className="modal-btn modal-btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateTicket}
                className="modal-btn modal-btn-primary"
              >
                Update Ticket
              </button>
            </div>
          </div>
        </div>
      </ModalPortal>
    </div>
  )
}
