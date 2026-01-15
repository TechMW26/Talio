'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext'
import { FaPlus, FaTicketAlt, FaCheckCircle, FaClock, FaExclamationCircle, FaTimes, FaCog } from 'react-icons/fa'
import { getCurrentUser, getEmployeeId } from '@/utils/userHelper'
import ModalPortal from '@/components/ui/ModalPortal'
import Loader from '@/components/ui/Loader'

export default function HelpdeskPage() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])
  const router = useRouter()
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [isManager, setIsManager] = useState(false)
  const [formData, setFormData] = useState({
    subject: '',
    category: '',
    priority: 'medium',
    description: ''
  })

  // Real-time updates
  const { socket, isConnected, onHelpdeskTicket, subscribe } = useSocket()

  // Subscribe to real-time helpdesk updates
  useEffect(() => {
    if (!socket || !isConnected || !user) return

    const empId = getEmployeeId(user)
    if (!empId) return

    const handleHelpdeskUpdate = (data) => {
      console.log('🔄 [Helpdesk] Real-time update received:', data)
      fetchTickets(empId)
    }

    const unsub1 = onHelpdeskTicket?.(handleHelpdeskUpdate)
    const unsub2 = subscribe?.(REALTIME_EVENTS.HELPDESK_TICKET, handleHelpdeskUpdate)
    const unsub3 = subscribe?.(REALTIME_EVENTS.HELPDESK_TICKET_UPDATED, handleHelpdeskUpdate)

    return () => {
      unsub1?.()
      unsub2?.()
      unsub3?.()
    }
  }, [socket, isConnected, user])

  useEffect(() => {
    const parsedUser = getCurrentUser()
    if (parsedUser) {
      setUser(parsedUser)
      // Check if user can manage tickets
      setIsManager(['admin', 'hr', 'manager', 'department_head', 'super_admin'].includes(parsedUser.role))
      const empId = getEmployeeId(parsedUser)
      if (empId) {
        fetchTickets(empId)
      } else {
        console.error('Employee ID not found in user data:', parsedUser)
        toast.error('Employee information not found. Please logout and login again.')
        setLoading(false)
      }
    } else {
      console.error('No user data found')
      toast.error('Please login to view tickets')
      setLoading(false)
    }
  }, [])

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const empId = getEmployeeId(user)
    if (!empId) {
      toast.error('Employee ID not found')
      return
    }

    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/helpdesk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          ...formData,
          createdBy: empId
        })
      })
      const data = await response.json()
      if (data.success) {
        toast.success('Ticket created successfully')
        setShowModal(false)
        fetchTickets(empId)
        setFormData({
          subject: '',
          category: '',
          priority: 'medium',
          description: ''
        })
      } else {
        toast.error(data.message || 'Failed to create ticket')
      }
    } catch (error) {
      console.error('Create ticket error:', error)
      toast.error('Failed to create ticket')
    }
  }

  const fetchTickets = async (employeeId) => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/helpdesk?employeeId=${employeeId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()
      if (data.success) {
        setTickets(data.data || [])
      } else {
        console.error('API Error:', data.message)
        toast.error(data.message || 'Failed to fetch tickets')
      }
    } catch (error) {
      console.error('Fetch tickets error:', error)
      toast.error('Failed to fetch tickets')
    } finally {
      setLoading(false)
    }
  }

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
      iconColor: 'text-yellow-600'
    },
    {
      label: 'In Progress',
      value: tickets.filter(t => t.status === 'in-progress').length,
      icon: FaExclamationCircle,
      bgColor: 'bg-orange-100',
      iconColor: 'text-orange-600'
    },
    {
      label: 'Resolved',
      value: tickets.filter(t => t.status === 'resolved').length,
      icon: FaCheckCircle,
      bgColor: 'bg-green-100',
      iconColor: 'text-green-600'
    }
  ]

  // Prevent hydration mismatch
  if (!mounted) {
    return (
      <div className="space-y-6">
        <div className="space-y-4 animate-pulse">
          <div className="w-1/4 h-10 bg-gray-200 rounded"></div>
          <div className="h-32 bg-gray-200 rounded"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Helpdesk</h1>
          <p className="mt-1 text-sm text-gray-600">Submit and track support tickets</p>
        </div>
        <div className="flex gap-3">
          {isManager && (
            <button
              onClick={() => router.push('/dashboard/helpdesk/manage')}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition-colors"
            >
              <FaCog className="w-4 h-4" />
              <span>Manage All Tickets</span>
            </button>
          )}
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
          >
            <FaPlus className="w-4 h-4" />
            <span>Create Ticket</span>
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat, index) => (
          <div key={index} className="p-4 bg-white border border-gray-100 shadow-sm rounded-xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="mb-1 text-sm text-gray-600">{stat.label}</p>
                <p className="text-2xl font-bold text-gray-900 sm:text-3xl">{stat.value}</p>
              </div>
              <div className={`p-3 rounded-xl ${stat.bgColor}`}>
                <stat.icon className={`w-5 h-5 sm:w-6 sm:h-6 ${stat.iconColor}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Tickets Table */}
      <div className="overflow-hidden bg-white rounded-lg shadow-md">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-800">My Tickets</h2>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <Loader size="lg" className="mx-auto" />
            <p className="mt-4 text-gray-600">Loading tickets...</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                    Ticket #
                  </th>
                  <th className="px-6 py-3 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                    Subject
                  </th>
                  <th className="px-6 py-3 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                    Category
                  </th>
                  <th className="px-6 py-3 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                    Priority
                  </th>
                  <th className="px-6 py-3 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                    Status
                  </th>
                  <th className="px-6 py-3 text-xs font-medium tracking-wider text-left text-gray-500 uppercase">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {tickets.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="px-6 py-4 text-center text-gray-500">
                      No tickets found
                    </td>
                  </tr>
                ) : (
                  tickets.map((ticket) => (
                    <tr 
                      key={ticket._id} 
                      className="transition-colors cursor-pointer hover:bg-gray-50"
                      onClick={() => router.push(`/dashboard/helpdesk/${ticket._id}`)}
                    >
                      <td className="px-6 py-4 text-sm font-medium whitespace-nowrap text-primary-600">
                        {ticket?.ticketNumber || 'N/A'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {ticket?.subject || 'N/A'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900 whitespace-nowrap">
                        {ticket?.category || 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            ticket?.priority === 'urgent' || ticket?.priority === 'low' ? 'bg-red-200 text-red-900' :
                            ticket?.priority === 'high' ? 'bg-red-100 text-red-800' :
                            ticket?.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                              'bg-green-100 text-green-800'
                          }`}>
                          {ticket?.priority || 'low'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${ticket?.status === 'resolved' ? 'bg-green-100 text-green-800' :
                            ticket?.status === 'in-progress' ? 'bg-blue-100 text-blue-800' :
                              'bg-yellow-100 text-yellow-800'
                          }`}>
                          {ticket?.status || 'open'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 whitespace-nowrap">
                        {ticket?.createdAt ? new Date(ticket.createdAt).toLocaleDateString() : 'N/A'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Ticket Modal */}
      <ModalPortal isOpen={showModal}>
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal-backdrop" />
          <div className="modal-container modal-md">
            <div className="modal-header">
              <h2 className="modal-title">Create Ticket</h2>
              <button onClick={() => setShowModal(false)} className="modal-close-btn">
                <FaTimes className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="space-y-4 modal-body">
                <div>
                  <label className="modal-label">
                    Subject
                  </label>
                  <input
                    type="text"
                    name="subject"
                    value={formData.subject}
                    onChange={handleInputChange}
                    required
                    className="modal-input"
                    placeholder="Brief description of the issue"
                  />
                </div>

                <div>
                  <label className="modal-label">
                    Category
                  </label>
                  <select
                    name="category"
                    value={formData.category}
                    onChange={handleInputChange}
                    required
                    className="modal-select"
                  >
                    <option value="">Select Category</option>
                    <option value="it-support">IT Support</option>
                    <option value="hr-query">HR Query</option>
                    <option value="payroll">Payroll</option>
                    <option value="leave">Leave</option>
                    <option value="attendance">Attendance</option>
                    <option value="facilities">Facilities</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="modal-label">
                    Priority
                  </label>
                  <select
                    name="priority"
                    value={formData.priority}
                    onChange={handleInputChange}
                    className="modal-select"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>

                <div>
                  <label className="modal-label">
                    Description
                  </label>
                  <textarea
                    name="description"
                    value={formData.description}
                    onChange={handleInputChange}
                    required
                    rows="4"
                    className="modal-textarea"
                    placeholder="Detailed description of the issue"
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="modal-btn modal-btn-secondary"
                >
                  Cancel
                </button>
                <button type="submit" className="modal-btn modal-btn-primary">
                  Create Ticket
                </button>
              </div>
            </form>
          </div>
        </div>
      </ModalPortal>
    </div>
  )
}

