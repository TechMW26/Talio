'use client'
import { useState, useEffect } from 'react'
import { FaHeadset, FaPlus } from 'react-icons/fa'
import { useRouter } from 'next/navigation'
import { getEmployeeId } from '@/utils/userHelper'

export default function MyHelpdeskWidget({ user }) {
  const router = useRouter()
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (user) fetchTickets()
  }, [user])

  const fetchTickets = async () => {
    try {
      const employeeId = getEmployeeId(user)
      if (!employeeId) return
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/helpdesk?employeeId=${employeeId}&limit=3`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) setTickets(data.data)
    } catch (error) {
      console.error('Error fetching tickets:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 bg-gray-200 rounded"></div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base sm:text-lg font-bold text-gray-800">Helpdesk</h3>
        <button 
          onClick={() => router.push('/dashboard/helpdesk')}
          className="text-primary-600 hover:text-primary-800 text-sm font-medium flex items-center gap-1"
        >
          <FaPlus className="w-3 h-3" /> New
        </button>
      </div>
      {tickets.length === 0 ? (
        <div className="text-center py-6 text-gray-500">
          <FaHeadset className="w-8 h-8 mx-auto mb-2 text-gray-400" />
          <p className="text-sm">No open tickets</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {tickets.slice(0, 5).map(ticket => (
            <div key={ticket._id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
              <div className="min-w-0 flex-1 pr-2">
                <p className="text-sm font-medium text-gray-800 truncate">{ticket.subject}</p>
                <p className="text-xs text-gray-500 capitalize">{ticket.priority} priority</p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap capitalize ${
                ticket.status === 'open' ? 'bg-green-100 text-green-700' :
                ticket.status === 'in-progress' ? 'bg-blue-100 text-blue-700' :
                ticket.status === 'resolved' ? 'bg-purple-100 text-purple-700' :
                'bg-gray-100 text-gray-700'
              }`}>
                {ticket.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
