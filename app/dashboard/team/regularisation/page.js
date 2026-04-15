'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { FaCheck, FaTimes, FaCalendarCheck, FaExclamationCircle, FaChevronDown, FaChevronUp, FaFilter, FaBuilding, FaUserFriends } from 'react-icons/fa'
import { Card, CardBody, Chip, Skeleton, Select, SelectItem, Avatar, Accordion, AccordionItem } from '@heroui/react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'

export default function TeamRegularisationPage() {
  const router = useRouter()
  const [expandedCards, setExpandedCards] = useState({})
  const [statusFilter, setStatusFilter] = useState('pending')
  const [selectedDepartment, setSelectedDepartment] = useState('all')
  const [selectedTeam, setSelectedTeam] = useState('all')
  const [processingCorrection, setProcessingCorrection] = useState(null)

  const user = useMemo(() => {
    if (typeof window === 'undefined') return null
    try { return JSON.parse(localStorage.getItem('user')) } catch { return null }
  }, [])

  const isAdminOrHR = ['admin', 'hr'].includes(user?.role)

  // Check department head access for non-admin/HR users
  const { data: accessRes, isLoading: accessLoading } = useAuthedSWR(
    user && !isAdminOrHR ? '/api/team/check-head' : null
  )
  const hasAccess = isAdminOrHR || (accessRes?.success && (accessRes?.isDepartmentHead || accessRes?.isTeamLeader))
  const accessResolved = isAdminOrHR || (!accessLoading && accessRes !== undefined)

  // Fetch departments (admin/HR only)
  const { data: deptsRes } = useAuthedSWR(isAdminOrHR ? '/api/departments' : null)
  const departments = deptsRes?.data || []

  // Headed departments for department heads
  const headedDepartments = accessRes?.departments || []
  const isDepartmentHead = accessRes?.isDepartmentHead
  const isTeamLeader = accessRes?.isTeamLeader
  const teamLeaderTeams = accessRes?.teamLeaderTeams || []

  // Fetch teams for the selected department
  const teamsSwrKey = (() => {
    if (isAdminOrHR) {
      return selectedDepartment !== 'all' ? `/api/teams?department=${selectedDepartment}` : null
    }
    if (isDepartmentHead) {
      if (selectedDepartment !== 'all') return `/api/teams?department=${selectedDepartment}`
      if (headedDepartments.length === 1) return `/api/teams?department=${headedDepartments[0]._id}`
      return null
    }
    if (isTeamLeader) return null // Use teamLeaderTeams directly
    return null
  })()
  const { data: teamsRes } = useAuthedSWR(teamsSwrKey)
  const availableTeams = isTeamLeader && !isDepartmentHead && !isAdminOrHR
    ? teamLeaderTeams
    : (teamsRes?.data || teamsRes?.teams || [])

  // Build query params for corrections
  const deptParam = selectedDepartment && selectedDepartment !== 'all' ? `&department=${selectedDepartment}` : ''
  const teamParam = selectedTeam && selectedTeam !== 'all' ? `&team=${selectedTeam}` : ''

  // Fetch pending corrections
  const {
    data: pendingRes,
    error: pendingError,
    isLoading: pendingLoading,
    isValidating: pendingValidating,
    mutate: refreshPending,
  } = useAuthedSWR(hasAccess ? `/api/attendance/corrections?type=pending${deptParam}${teamParam}` : null)
  const pendingCorrections = pendingRes?.data || []

  // Fetch all corrections (history)
  const {
    data: allRes,
    error: allError,
    isLoading: allLoading,
    isValidating: allValidating,
    mutate: refreshAll,
  } = useAuthedSWR(hasAccess ? `/api/attendance/corrections?type=all${deptParam}${teamParam}` : null)
  const allCorrections = allRes?.data || []

  const isLoading = !accessResolved || (hasAccess && (pendingLoading || allLoading))
  const error = pendingError || allError
  const isValidating = pendingValidating || allValidating

  const refresh = () => { refreshPending(); refreshAll() }

  // Mutation for approve/reject
  const { execute: executeAction } = useApiMutation({
    method: 'PATCH',
    onSuccess: (data) => {
      toast.success(data.message || 'Correction updated successfully')
      setProcessingCorrection(null)
      refresh()
    },
    onError: (err) => {
      toast.error(err.message || 'Failed to update correction')
      setProcessingCorrection(null)
    },
  })

  const handleApproveReject = async (correctionId, action, comments = '') => {
    setProcessingCorrection(correctionId)
    await executeAction('/api/attendance/corrections', {
      correctionId,
      action,
      reviewerComments: comments,
    })
  }

  const formatTime = (dateString, { timeZone } = {}) => {
    if (!dateString) return 'N/A'
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      ...(timeZone ? { timeZone } : {})
    })
  }

  const formatRequestedTime = (dateString) => formatTime(dateString)

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

  if (isLoading) {
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

  if (error) {
    return (
      <div className="min-h-screen px-4 py-4 sm:p-6 lg:p-8 pb-14 md:pb-6">
        <DataErrorState
          title="Error loading regularisation data"
          message={error.message || 'Failed to load attendance corrections'}
          onRetry={refresh}
        />
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
            <BackgroundRefreshIndicator isValidating={isValidating} className="ml-2" />
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Department filter - only for admin/HR */}
          {/* Department filter - admin/HR */}
          {isAdminOrHR && departments.length > 0 && (
            <Select
              label="Department"
              placeholder="All Departments"
              selectedKeys={selectedDepartment ? [selectedDepartment] : []}
              onChange={(e) => { setSelectedDepartment(e.target.value); setSelectedTeam('all') }}
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

          {/* Department filter - department heads with multiple departments */}
          {!isAdminOrHR && isDepartmentHead && headedDepartments.length > 1 && (
            <Select
              label="Department"
              placeholder="All My Departments"
              selectedKeys={selectedDepartment ? [selectedDepartment] : []}
              onChange={(e) => { setSelectedDepartment(e.target.value); setSelectedTeam('all') }}
              className="w-48"
              size="sm"
              startContent={<FaBuilding className="text-default-400" />}
            >
              <SelectItem key="all" value="all">All My Departments</SelectItem>
              {headedDepartments.map(dept => (
                <SelectItem key={dept._id} value={dept._id}>{dept.name}</SelectItem>
              ))}
            </Select>
          )}

          {/* Team filter */}
          {availableTeams.length > 0 && (
            <Select
              label="Team"
              placeholder="All Teams"
              selectedKeys={selectedTeam ? [selectedTeam] : []}
              onChange={(e) => setSelectedTeam(e.target.value)}
              className="w-48"
              size="sm"
              startContent={<FaUserFriends className="text-default-400" />}
            >
              <SelectItem key="all" value="all">All Teams</SelectItem>
              {availableTeams.map(team => (
                <SelectItem key={team._id} value={team._id}>{team.teamName}</SelectItem>
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
              className={`border-l-4 overflow-visible ${correction.status === 'pending' ? 'border-l-warning-500' :
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
                        <LoadingButton
                          color="danger"
                          variant="flat"
                          startContent={<FaTimes />}
                          onPress={() => {
                            const comment = prompt('Reason for rejection (optional):')
                            handleApproveReject(correction._id, 'reject', comment || '')
                          }}
                          isLoading={processingCorrection === correction._id}
                          loadingText="Rejecting..."
                        >
                          Reject
                        </LoadingButton>
                        <LoadingButton
                          color="success"
                          startContent={<FaCheck />}
                          onPress={() => handleApproveReject(correction._id, 'approve')}
                          isLoading={processingCorrection === correction._id}
                          loadingText="Approving..."
                        >
                          Approve
                        </LoadingButton>
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
