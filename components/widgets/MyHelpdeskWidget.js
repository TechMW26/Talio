'use client'
import { useState, useEffect } from 'react'
import { FaHeadset, FaPlus } from 'react-icons/fa'
import { useRouter } from 'next/navigation'
import { getEmployeeId } from '@/utils/userHelper'
import { Card, CardBody, Button, Chip, Skeleton, ScrollShadow } from '@heroui/react'

export default function MyHelpdeskWidget({ user, initialData }) {
  const router = useRouter()
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(!initialData)

  useEffect(() => {
    // Skip fetch if initialData provided from unified dashboard call
    if (initialData) {
      setTickets(initialData)
      setLoading(false)
      return
    }
    if (user) fetchTickets()
  }, [user, initialData])

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

  const getStatusColor = (status) => {
    switch (status) {
      case 'open': return 'success'
      case 'in-progress': return 'primary'
      case 'resolved': return 'secondary'
      default: return 'default'
    }
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
        <Skeleton className="h-6 w-1/3 rounded-lg mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex items-center gap-3">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4 rounded-lg" />
                <Skeleton className="h-3 w-1/2 rounded-lg" />
              </div>
              <Skeleton className="h-5 w-16 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base sm:text-lg font-bold text-default-900">Helpdesk</h3>
        <Button
          variant="light"
          color="primary"
          size="sm"
          startContent={<FaPlus className="w-3 h-3" />}
          onPress={() => router.push('/dashboard/helpdesk')}
        >
          New
        </Button>
      </div>
      {tickets.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-6">
          <img
            src="/assets/Helpdesk.png"
            alt="No open tickets"
            className="w-24 h-24 object-contain mb-3"
          />
          <p className="text-sm text-default-500">No open tickets</p>
        </div>
      ) : (
        <ScrollShadow className="space-y-2 max-h-[200px]">
          {tickets.slice(0, 5).map(ticket => (
            <Card key={ticket._id} className="border border-default-100">
              <CardBody className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1 pr-2">
                    <p className="text-sm font-semibold text-default-900 truncate">{ticket.subject}</p>
                    <p className="text-xs text-default-500 capitalize">{ticket.priority} priority</p>
                  </div>
                  <Chip size="sm" color={getStatusColor(ticket.status)} variant="flat" className="capitalize whitespace-nowrap">
                    {ticket.status}
                  </Chip>
                </div>
              </CardBody>
            </Card>
          ))}
        </ScrollShadow>
      )}
    </div>
  )
}
