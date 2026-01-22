'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { FaCheck, FaTimes, FaCalendarCheck, FaExclamationCircle, FaChevronDown, FaChevronUp, FaFilter, FaBuilding } from 'react-icons/fa'
import { Card, CardBody, Button, Chip, Skeleton, Select, SelectItem, Avatar, Accordion, AccordionItem } from '@heroui/react'

export default function TeamRegularisationPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [hasAccess, setHasAccess] = useState(false)
  const [pendingCorrections, setPendingCorrections] = useState([])
  const [allCorrections, setAllCorrections] = useState([])
  const [processingCorrection, setProcessingCorrection] = useState(null)
  const [expandedCards, setExpandedCards] = useState({})
  const [statusFilter, setStatusFilter] = useState('pending')
  const [departments, setDepartments] = useState([])
  const [selectedDepartment, setSelectedDepartment] = useState('all')

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      const parsedUser = JSON.parse(userData)
      setUser(parsedUser)
      checkAccess(parsedUser)
    }
  }, [])

  const checkAccess = async (currentUser) => {
    try {
      // Admin and HR have full access
      if (['admin', 'hr'].includes(currentUser?.role)) {
        setHasAccess(true)
        fetchDepartments()
        fetchCorrections()
        return
      }

      // Check for department head status
      const token = localStorage.getItem('token')
      const response = await fetch('/api/team/check-head', {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      const data = await response.json()
      
      if (data.success && data.isDepartmentHead) {
        setHasAccess(true)
        fetchCorrections()
      } else {
        setHasAccess(false)
        setLoading(false)
      }
    } catch (error) {
      console.error('Error checking access:', error)
      setLoading(false)
    }
  }

  const fetchDepartments = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/departments', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setDepartments(data.data || [])
      }
    } catch (error) {
      console.error('Error fetching departments:', error)
    }
  }

  const fetchCorrections = async () => {
    try {
      const token = localStorage.getItem('token')
      
      // Build query params
      let queryParams = 'type=pending'
      if (selectedDepartment && selectedDepartment !== 'all') {
        queryParams += `&department=${selectedDepartment}`
      }
      
      // Fetch pending corrections
      const pendingResponse = await fetch(`/api/attendance/corrections?${queryParams}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const pendingData = await pendingResponse.json()
      
      // Fetch all corrections for history
      let allQueryParams = 'type=all'
      if (selectedDepartment && selectedDepartment !== 'all') {
        allQueryParams += `&department=${selectedDepartment}`
      }
      const allResponse = await fetch(`/api/attendance/corrections?${allQueryParams}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const allData = await allResponse.json()
      
      if (pendingData.success) {
        setPendingCorrections(pendingData.data)
      }
      if (allData.success) {
        setAllCorrections(allData.data)
      }
    } catch (error) {
      console.error('Fetch corrections error:', error)
    } finally {
      setLoading(false)
    }
  }

  // Refetch when department filter changes
  useEffect(() => {
    if (hasAccess) {
      setLoading(true)
      fetchCorrections()
    }
  }, [selectedDepartment])

  const handleApproveReject = async (correctionId, action, comments = '') => {
    setProcessingCorrection(correctionId)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/attendance/corrections', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          correctionId,
          action,
          reviewerComments: comments
        })
      })

      const data = await response.json()
      if (data.success) {
        toast.success(`Correction ${action}d successfully`)
        fetchCorrections()
      } else {
        toast.error(data.message || `Failed to ${action} correction`)
      }
    } catch (error) {
      console.error(`${action} correction error:`, error)
      toast.error(`Failed to ${action} correction`)
    } finally {
      setProcessingCorrection(null)
    }
  }

  const formatTime = (dateString, { timeZone } = {}) => {
    if (!dateString) return 'N/A'
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      ...(timeZone ? { timeZone } : {})
    })
  }

  const formatRequestedTime = (dateString) => formatTime(dateString, { timeZone: 'UTC' })

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const toggleCard = (id) => {
    setExpandedCards(prev => ({
      ...prev,
      [id]: !prev[id]
    }))
  }

  const getFilteredCorrections = () => {
    if (statusFilter === 'pending') {
      return pendingCorrections
    }
    return allCorrections.filter(c => statusFilter === 'all' || c.status === statusFilter)
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending':
        return 'warning'
      case 'approved':
        return 'success'
      case 'rejected':
        return 'danger'
      default:
        return 'default'
    }
  }

  const isAdminOrHR = ['admin', 'hr'].includes(user?.role)

  if (loading) {
    return (
      <div className="min-h-screen px-4 py-4 sm:p-6 lg:p-8 pb-14 md:pb-6">
        <div className="mb-6">
          <Skeleton className="h-10 w-72 rounded-lg mb-2" />
          <Skeleton className="h-5 w-96 rounded-lg" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  if (!hasAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-4 sm:p-6 lg:p-8 pb-14 md:pb-6">
        <Card className="max-w-md">
          <CardBody className="text-center py-10 px-8">
            <div className="w-16 h-16 bg-warning-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <FaExclamationCircle className="h-8 w-8 text-warning-500" />
            </div>
            <h2 className="text-2xl font-bold text-default-900 mb-2">Access Restricted</h2>
            <p className="text-default-500">This section is only available to admins, HR, and department heads.</p>
          </CardBody>
        </Card>
      </div>
    )
  }

  const filteredCorrections = getFilteredCorrections()

  return (
    <div className="min-h-screen bg-default-50 px-4 py-4 sm:p-6 lg:p-8 pb-14 md:pb-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-default-900">Attendance Regularisation</h1>
          <p className="text-default-500 mt-1">
            Review and approve attendance correction requests {isAdminOrHR ? 'across all departments' : 'from your team'}
          </p>
        </div>
        
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Department filter - only for admin/HR */}
          {isAdminOrHR && departments.length > 0 && (
            <Select
              label="Department"
              placeholder="All Departments"
              selectedKeys={selectedDepartment ? [selectedDepartment] : []}
              onChange={(e) => setSelectedDepartment(e.target.value)}
              className="w-48"
              size="sm"
              startContent={<FaBuilding className="text-default-400" />}
            >
              <SelectItem key="all" value="all">All Departments</SelectItem>
              {departments.map(dept => (
                <SelectItem key={dept._id} value={dept._id}>{dept.name}</SelectItem>
              ))}
            </Select>
          )}
          
          {/* Status filter */}
          <Select
            label="Status"
            placeholder="Filter by status"
            selectedKeys={statusFilter ? [statusFilter] : []}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-44"
            size="sm"
            startContent={<FaFilter className="text-default-400" />}
          >
            <SelectItem key="pending" value="pending">Pending ({pendingCorrections.length})</SelectItem>
            <SelectItem key="approved" value="approved">Approved</SelectItem>
            <SelectItem key="rejected" value="rejected">Rejected</SelectItem>
            <SelectItem key="all" value="all">All Requests</SelectItem>
          </Select>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card shadow="sm" className="border-l-4 border-l-warning-500">
          <CardBody className="flex flex-row items-center justify-between">
            <div>
              <p className="text-sm text-warning-600 font-medium">Pending Requests</p>
              <p className="text-3xl font-bold text-warning-600 mt-1">
                {pendingCorrections.length}
              </p>
            </div>
            <div className="bg-warning-100 p-3 rounded-xl">
              <FaCalendarCheck className="h-6 w-6 text-warning-600" />
            </div>
          </CardBody>
        </Card>

        <Card shadow="sm" className="border-l-4 border-l-success-500">
          <CardBody className="flex flex-row items-center justify-between">
            <div>
              <p className="text-sm text-success-600 font-medium">Approved This Month</p>
              <p className="text-3xl font-bold text-success-600 mt-1">
                {allCorrections.filter(c => c.status === 'approved').length}
              </p>
            </div>
            <div className="bg-success-100 p-3 rounded-xl">
              <FaCheck className="h-6 w-6 text-success-600" />
            </div>
          </CardBody>
        </Card>

        <Card shadow="sm" className="border-l-4 border-l-danger-500">
          <CardBody className="flex flex-row items-center justify-between">
            <div>
              <p className="text-sm text-danger-600 font-medium">Rejected This Month</p>
              <p className="text-3xl font-bold text-danger-600 mt-1">
                {allCorrections.filter(c => c.status === 'rejected').length}
              </p>
            </div>
            <div className="bg-danger-100 p-3 rounded-xl">
              <FaTimes className="h-6 w-6 text-danger-600" />
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Corrections List */}
      {filteredCorrections.length === 0 ? (
        <Card shadow="sm">
          <CardBody className="py-12 text-center">
            <div className="w-20 h-20 bg-default-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <FaCalendarCheck className="h-10 w-10 text-default-300" />
            </div>
            <h3 className="text-xl font-semibold text-default-700 mb-2">No Requests Found</h3>
            <p className="text-default-500">
              {statusFilter === 'pending' 
                ? 'There are no pending attendance correction requests at the moment.'
                : `No ${statusFilter} requests found.`
              }
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredCorrections.map((correction) => (
            <Card 
              key={correction._id} 
              shadow="sm"
              className={`border-l-4 overflow-visible ${
                correction.status === 'pending' ? 'border-l-warning-500' :
                correction.status === 'approved' ? 'border-l-success-500' :
                'border-l-danger-500'
              }`}
            >
              <CardBody className="p-0">
                {/* Header - Always visible */}
                <div 
                  className="p-4 cursor-pointer hover:bg-default-50 transition-colors"
                  onClick={() => toggleCard(correction._id)}
                >
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="flex items-center space-x-4">
                      <Avatar
                        name={`${correction.employee?.firstName?.[0]}${correction.employee?.lastName?.[0]}`}
                        className="bg-gradient-to-br from-primary-400 to-primary-600 text-white font-bold"
                        size="lg"
                      />
                      <div>
                        <h3 className="font-semibold text-default-900 text-lg">
                          {correction.employee?.firstName} {correction.employee?.lastName}
                        </h3>
                        <p className="text-sm text-default-500">
                          {correction.employee?.designation?.title || 'Employee'} • {formatDate(correction.date)}
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-3">
                      <Chip color={getStatusColor(correction.status)} variant="flat" size="sm">
                        {correction.status.charAt(0).toUpperCase() + correction.status.slice(1)}
                      </Chip>
                      <Chip color="warning" variant="flat" size="sm" className="capitalize">
                        {correction.correctionType?.replace('-', ' ')}
                      </Chip>
                      {expandedCards[correction._id] ? (
                        <FaChevronUp className="text-default-400" />
                      ) : (
                        <FaChevronDown className="text-default-400" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Expanded Details */}
                {expandedCards[correction._id] && (
                  <div className="px-4 pb-4 pt-2 border-t border-default-100 bg-default-50">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                      {/* Current Record */}
                      <Card shadow="none" className="border border-default-200">
                        <CardBody>
                          <h4 className="text-xs font-semibold text-default-500 uppercase mb-3">Current Record</h4>
                          <div className="space-y-2">
                            <p className="text-sm text-default-700">
                              <span className="text-default-500">In:</span>{' '}
                              <span className="font-medium">{formatTime(correction.currentCheckIn)}</span>
                            </p>
                            <p className="text-sm text-default-700">
                              <span className="text-default-500">Out:</span>{' '}
                              <span className="font-medium">{formatTime(correction.currentCheckOut)}</span>
                            </p>
                            <p className="text-sm text-default-700">
                              <span className="text-default-500">Status:</span>{' '}
                              <span className="font-medium capitalize">{correction.currentStatus || 'N/A'}</span>
                            </p>
                          </div>
                        </CardBody>
                      </Card>

                      {/* Requested Changes */}
                      <Card shadow="none" className="border border-primary-200 bg-primary-50">
                        <CardBody>
                          <h4 className="text-xs font-semibold text-primary-600 uppercase mb-3">Requested Changes</h4>
                          <div className="space-y-2">
                            {correction.requestedCheckIn && (
                              <p className="text-sm">
                                <span className="text-primary-500">In:</span>{' '}
                                <span className="font-medium text-primary-700">{formatRequestedTime(correction.requestedCheckIn)}</span>
                              </p>
                            )}
                            {correction.requestedCheckOut && (
                              <p className="text-sm">
                                <span className="text-primary-500">Out:</span>{' '}
                                <span className="font-medium text-primary-700">{formatRequestedTime(correction.requestedCheckOut)}</span>
                              </p>
                            )}
                            {correction.requestedStatus && (
                              <p className="text-sm">
                                <span className="text-primary-500">Status:</span>{' '}
                                <span className="font-medium text-primary-700 capitalize">{correction.requestedStatus}</span>
                              </p>
                            )}
                          </div>
                        </CardBody>
                      </Card>

                      {/* Reason */}
                      <Card shadow="none" className="border border-warning-200 bg-warning-50">
                        <CardBody>
                          <h4 className="text-xs font-semibold text-warning-600 uppercase mb-3">Reason</h4>
                          <p className="text-sm text-default-700 italic">&quot;{correction.reason}&quot;</p>
                          <p className="text-xs text-default-400 mt-3">
                            Submitted: {new Date(correction.createdAt).toLocaleString()}
                          </p>
                        </CardBody>
                      </Card>
                    </div>

                    {/* Reviewer comments if any */}
                    {correction.reviewerComments && (
                      <Card shadow="none" className="border border-secondary-200 bg-secondary-50 mb-4">
                        <CardBody>
                          <h4 className="text-xs font-semibold text-secondary-600 uppercase mb-2">Reviewer Comments</h4>
                          <p className="text-sm text-default-700">{correction.reviewerComments}</p>
                          <p className="text-xs text-default-400 mt-2">
                            Reviewed by: {correction.reviewedBy?.firstName} {correction.reviewedBy?.lastName}
                          </p>
                        </CardBody>
                      </Card>
                    )}

                    {/* Action Buttons - Only for pending */}
                    {correction.status === 'pending' && (
                      <div className="flex justify-end space-x-3">
                        <Button
                          color="danger"
                          variant="flat"
                          startContent={<FaTimes />}
                          onPress={() => {
                            const comment = prompt('Reason for rejection (optional):')
                            handleApproveReject(correction._id, 'reject', comment || '')
                          }}
                          isDisabled={processingCorrection === correction._id}
                          isLoading={processingCorrection === correction._id}
                        >
                          Reject
                        </Button>
                        <Button
                          color="success"
                          startContent={<FaCheck />}
                          onPress={() => handleApproveReject(correction._id, 'approve')}
                          isDisabled={processingCorrection === correction._id}
                          isLoading={processingCorrection === correction._id}
                        >
                          Approve
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
