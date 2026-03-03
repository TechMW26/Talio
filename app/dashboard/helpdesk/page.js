'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext'
import { FaPlus, FaTicketAlt, FaCheckCircle, FaClock, FaExclamationCircle, FaTimes, FaCog } from 'react-icons/fa'
import { getCurrentUser, getEmployeeId } from '@/utils/userHelper'
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Select, SelectItem, Input, Textarea, Skeleton } from '@heroui/react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'

export default function HelpdeskPage() {
  const router = useRouter()
  const [showModal, setShowModal] = useState(false)
  const [formData, setFormData] = useState({
    subject: '',
    category: '',
    priority: 'medium',
    description: ''
  })

  const { user, employeeId, isManager } = useMemo(() => {
    const parsedUser = getCurrentUser()
    const empId = parsedUser ? getEmployeeId(parsedUser) : null
    const mgr = parsedUser && ['admin', 'hr', 'manager', 'department_head', 'super_admin'].includes(parsedUser.role)
    return { user: parsedUser, employeeId: empId, isManager: mgr }
  }, [])

  // --- SWR data fetching ---
  const isAdminHr = user && ['admin', 'hr'].includes(user.role)
  const swrKey = isAdminHr ? '/api/helpdesk' : (employeeId ? `/api/helpdesk?employeeId=${employeeId}` : null)
  const { data: ticketsRes, error, isLoading, isValidating, mutate: refreshTickets } = useAuthedSWR(swrKey)
  const tickets = ticketsRes?.data || []

  // Real-time updates
  const { socket, isConnected, onHelpdeskTicket, subscribe } = useSocket()

  useState(() => {
    if (!socket || !isConnected || !employeeId) return
    const handleHelpdeskUpdate = () => refreshTickets()
    const unsub1 = onHelpdeskTicket?.(handleHelpdeskUpdate)
    const unsub2 = subscribe?.(REALTIME_EVENTS.HELPDESK_TICKET, handleHelpdeskUpdate)
    const unsub3 = subscribe?.(REALTIME_EVENTS.HELPDESK_TICKET_UPDATED, handleHelpdeskUpdate)
    return () => { unsub1?.(); unsub2?.(); unsub3?.() }
  })

  // --- Submit mutation ---
  const submitMutation = useApiMutation({
    method: 'POST',
    invalidateKeys: [swrKey],
    onSuccess: () => {
      toast.success('Ticket created successfully')
      setShowModal(false)
      setFormData({ subject: '', category: '', priority: 'medium', description: '' })
    },
    onError: (msg) => toast.error(msg || 'Failed to create ticket'),
  })

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!employeeId) { toast.error('Employee ID not found'); return }
    submitMutation.execute('/api/helpdesk', { ...formData, createdBy: employeeId })
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

  if (error) {
    return <DataErrorState message="Failed to load tickets" onRetry={() => refreshTickets()} />
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Helpdesk</h1>
          <p className="mt-1 text-sm text-gray-600">Submit and track support tickets <BackgroundRefreshIndicator isValidating={isValidating} position="inline" /></p>
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
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-4 bg-white border border-gray-100 shadow-sm rounded-xl">
              <div className="flex items-center justify-between">
                <div className="space-y-2"><Skeleton className="w-20 h-4 rounded" /><Skeleton className="w-12 h-8 rounded" /></div>
                <Skeleton className="w-12 h-12 rounded-xl" />
              </div>
            </div>
          ))
        ) : (
          stats.map((stat, index) => (
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
          ))
        )}
      </div>

      {/* Tickets Table */}
      <div className="overflow-hidden bg-white rounded-lg shadow-md">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-800">My Tickets</h2>
        </div>

        {isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-4"><Skeleton className="w-20 h-5 rounded" /><Skeleton className="flex-1 h-5 rounded" /><Skeleton className="w-16 h-5 rounded" /><Skeleton className="w-16 h-5 rounded" /><Skeleton className="w-16 h-5 rounded" /><Skeleton className="w-24 h-5 rounded" /></div>
            ))}
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
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${ticket?.priority === 'urgent' || ticket?.priority === 'low' ? 'bg-red-200 text-red-900' :
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
      <Modal isOpen={showModal} onOpenChange={setShowModal} size="lg">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">Create Ticket</ModalHeader>
              <ModalBody>
                <form id="ticket-form" onSubmit={handleSubmit}>
                  <div className="space-y-4">
                    <Input
                      type="text"
                      label="Subject"
                      name="subject"
                      value={formData.subject}
                      onChange={handleInputChange}
                      isRequired
                      placeholder="Brief description of the issue"
                    />

                    <Select
                      label="Category"
                      selectedKeys={formData.category ? [formData.category] : []}
                      onSelectionChange={(keys) => setFormData(prev => ({ ...prev, category: Array.from(keys)[0] || '' }))}
                      isRequired
                      placeholder="Select Category"
                    >
                      <SelectItem key="it-support">IT Support</SelectItem>
                      <SelectItem key="hr-query">HR Query</SelectItem>
                      <SelectItem key="payroll">Payroll</SelectItem>
                      <SelectItem key="leave">Leave</SelectItem>
                      <SelectItem key="attendance">Attendance</SelectItem>
                      <SelectItem key="facilities">Facilities</SelectItem>
                      <SelectItem key="other">Other</SelectItem>
                    </Select>

                    <Select
                      label="Priority"
                      selectedKeys={[formData.priority]}
                      onSelectionChange={(keys) => setFormData(prev => ({ ...prev, priority: Array.from(keys)[0] || 'medium' }))}
                    >
                      <SelectItem key="low">Low</SelectItem>
                      <SelectItem key="medium">Medium</SelectItem>
                      <SelectItem key="high">High</SelectItem>
                      <SelectItem key="urgent">Urgent</SelectItem>
                    </Select>

                    <Textarea
                      label="Description"
                      name="description"
                      value={formData.description}
                      onChange={handleInputChange}
                      isRequired
                      minRows={4}
                      placeholder="Detailed description of the issue"
                    />
                  </div>
                </form>
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose}>
                  Cancel
                </Button>
                <LoadingButton color="primary" type="submit" form="ticket-form" isLoading={submitMutation.isLoading} loadingText="Creating...">
                  Create Ticket
                </LoadingButton>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  )
}

