'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { FaPlus, FaEye, FaEdit, FaTrash, FaStar, FaSearch, FaFilter, FaUser, FaUserFriends } from 'react-icons/fa'
import { Select, SelectItem, Input, Skeleton } from '@heroui/react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'

export default function EmployeeRatingsPage() {
  const router = useRouter()
  const [searchTerm, setSearchTerm] = useState('')
  const [filterCategory, setFilterCategory] = useState('all')
  const [selectedDepartment, setSelectedDepartment] = useState('all')
  const [selectedTeam, setSelectedTeam] = useState('all')

  const user = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('user')) } catch { return null }
  }, [])

  const isAdminOrHR = user && ['admin', 'hr'].includes(user.role)

  // Check department head status
  const { data: headCheckRes } = useAuthedSWR(user ? '/api/team/check-head' : null)
  const isDepartmentHead = headCheckRes?.success && headCheckRes?.isDepartmentHead
  const headedDepartments = headCheckRes?.departments || []

  // Fetch all departments for admin/HR
  const { data: deptsRes } = useAuthedSWR(isAdminOrHR ? '/api/departments' : null)
  const allDepartments = deptsRes?.data || []

  // Available departments for filter
  const departments = isAdminOrHR ? allDepartments : headedDepartments

  // Fetch teams for selected department
  const teamsFetchKey = (() => {
    if (selectedDepartment && selectedDepartment !== 'all') return `/api/teams?department=${selectedDepartment}`
    if (!isAdminOrHR && headedDepartments.length === 1) return `/api/teams?department=${headedDepartments[0]?._id}`
    return null
  })()
  const { data: teamsRes } = useAuthedSWR(teamsFetchKey)
  const availableTeams = teamsRes?.data || []

  // Build SWR key with department + team filters
  const ratingsSwrKey = useMemo(() => {
    let url = '/api/performance/ratings'
    const params = []
    if (isDepartmentHead && headedDepartments.length > 0 && selectedDepartment === 'all') {
      params.push(`departments=${headedDepartments.map(d => d._id).join(',')}`)
    } else if (selectedDepartment && selectedDepartment !== 'all') {
      params.push(`department=${selectedDepartment}`)
    }
    if (selectedTeam && selectedTeam !== 'all') {
      params.push(`team=${selectedTeam}`)
    }
    if (params.length > 0) url += '?' + params.join('&')
    return url
  }, [selectedDepartment, selectedTeam, isDepartmentHead, headedDepartments])

  // SWR: fetch ratings
  const { data: res, error, isLoading, isValidating, mutate: refresh } = useAuthedSWR(ratingsSwrKey)
  const ratings = res?.data || []

  // Mutation: delete rating
  const deleteMutation = useApiMutation({
    invalidateKeys: ['/api/performance/ratings'],
    onSuccess: () => toast.success('Rating deleted successfully'),
    onError: (msg) => toast.error(msg || 'Failed to delete rating'),
  })

  const handleDelete = async (ratingId) => {
    if (!confirm('Are you sure you want to delete this rating?')) return
    deleteMutation.execute(`/api/performance/ratings?id=${ratingId}`, null, { method: 'DELETE' })
  }

  const canManageRatings = () => {
    return user && ['admin', 'hr', 'manager', 'department_head'].includes(user.role)
  }

  const getRatingStars = (rating) => {
    const stars = []
    for (let i = 1; i <= 5; i++) {
      stars.push(
        <FaStar
          key={i}
          className={`w-4 h-4 ${i <= rating ? 'text-yellow-400' : 'text-gray-300'}`}
        />
      )
    }
    return stars
  }

  const getRatingColor = (rating) => {
    if (rating >= 4.5) return 'text-green-600'
    if (rating >= 3.5) return 'text-blue-600'
    if (rating >= 2.5) return 'text-yellow-600'
    return 'text-red-600'
  }

  const filteredRatings = ratings.filter(rating => {
    const matchesSearch = searchTerm === '' ||
      `${rating.employee.firstName} ${rating.employee.lastName}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
      rating.employee.employeeCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      rating.employee.department.toLowerCase().includes(searchTerm.toLowerCase())

    const matchesFilter = filterCategory === 'all' || rating.category === filterCategory

    return matchesSearch && matchesFilter
  })

  if (isLoading) {
    return (
      <div className="p-6 pb-24 md:pb-6">
        <div className="mb-6">
          <Skeleton className="h-8 w-56 rounded-lg mb-2" />
          <Skeleton className="h-4 w-72 rounded-lg" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg shadow-md p-6">
              <Skeleton className="h-4 w-24 rounded mb-3" />
              <Skeleton className="h-8 w-16 rounded" />
            </div>
          ))}
        </div>
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-start space-x-4">
                <Skeleton className="w-12 h-12 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-5 w-40 rounded mb-2" />
                  <Skeleton className="h-4 w-24 rounded mb-1" />
                  <Skeleton className="h-4 w-32 rounded" />
                </div>
              </div>
              <Skeleton className="h-16 w-full rounded-lg mt-4" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 pb-24 md:pb-6">
        <DataErrorState message="Failed to load employee ratings" onRetry={() => refresh()} />
      </div>
    )
  }

  return (
    <div className="p-6 pb-24 md:pb-6">
      {/* Header */}
      <div className="flex md:justify-between md:items-center md:flex-row flex-col mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Employee Ratings</h1>
          <p className="text-gray-600 mt-1">Manage employee performance ratings and reviews <BackgroundRefreshIndicator isValidating={isValidating && !isLoading} position="inline" /></p>
        </div>

      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
        {[
          {
            title: 'Total Reviews',
            value: ratings.length,
            color: 'bg-blue-500',
            icon: FaUser
          },
          {
            title: 'Average Rating',
            value: ratings.filter(r => r.rating > 0).length > 0
              ? (ratings.filter(r => r.rating > 0).reduce((sum, r) => sum + r.rating, 0) / ratings.filter(r => r.rating > 0).length).toFixed(1)
              : '0.0',
            color: 'bg-green-500',
            icon: FaStar
          },
          {
            title: 'High Performers',
            value: ratings.filter(r => r.rating >= 4.5).length,
            color: 'bg-yellow-500',
            icon: FaStar
          },
          {
            title: 'This Month',
            value: ratings.filter(r => {
              const date = new Date(r.createdAt)
              const now = new Date()
              return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()
            }).length,
            color: 'bg-purple-500',
            icon: FaUser
          },
        ].map((stat, index) => (
          <div key={index} className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm font-medium">{stat.title}</p>
                <h3 className="text-2xl font-bold text-gray-900 mt-2">{stat.value}</h3>
              </div>
              <div className={`${stat.color} p-4 rounded-lg`}>
                <stat.icon className="w-6 h-6 text-white" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
          <div className="flex flex-wrap items-center gap-4">
            <div className="w-64">
              <Input
                type="text"
                placeholder="Search employees..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                startContent={<FaSearch className="text-default-400 w-4 h-4" />}
                size="sm"
                variant="bordered"
                classNames={{
                  inputWrapper: "bg-default-50 dark:bg-[#1E293B] shadow-none",
                }}
              />
            </div>
            <div className="flex items-center space-x-2">
              <FaFilter className="text-gray-400 w-4 h-4" />
              <Select
                selectedKeys={[filterCategory]}
                onSelectionChange={(keys) => setFilterCategory(Array.from(keys)[0] || 'all')}
                className="w-44"
                size="sm"
                aria-label="Filter by category"
              >
                <SelectItem key="all">All Categories</SelectItem>
                <SelectItem key="performance">Performance</SelectItem>
                <SelectItem key="behavior">Behavior</SelectItem>
                <SelectItem key="skills">Skills</SelectItem>
                <SelectItem key="general">General</SelectItem>
              </Select>
            </div>

            {/* Department Filter */}
            {departments.length > 1 && (
              <Select
                selectedKeys={[selectedDepartment]}
                onSelectionChange={(keys) => { setSelectedDepartment(Array.from(keys)[0] || 'all'); setSelectedTeam('all') }}
                className="w-48"
                size="sm"
                aria-label="Filter by department"
              >
                <SelectItem key="all">{isDepartmentHead ? 'All My Departments' : 'All Departments'}</SelectItem>
                {departments.map((dept) => (
                  <SelectItem key={dept._id}>{dept.name}</SelectItem>
                ))}
              </Select>
            )}

            {/* Team Filter */}
            {availableTeams.length > 0 && (
              <div className="flex items-center space-x-2">
                <FaUserFriends className="text-gray-400 w-4 h-4" />
                <Select
                  selectedKeys={[selectedTeam]}
                  onSelectionChange={(keys) => setSelectedTeam(Array.from(keys)[0] || 'all')}
                  className="w-44"
                  size="sm"
                  aria-label="Filter by team"
                >
                  <SelectItem key="all">All Teams</SelectItem>
                  {availableTeams.map((team) => (
                    <SelectItem key={team._id}>{team.teamName}</SelectItem>
                  ))}
                </Select>
              </div>
            )}
          </div>
          <div className="text-sm text-gray-500">
            {filteredRatings.length} review{filteredRatings.length !== 1 ? 's' : ''} found
          </div>
        </div>
      </div>

      {/* Ratings List */}
      {filteredRatings.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-8 text-center">
          <FaStar className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No ratings found</h3>
          <p className="text-gray-500">
            {canManageRatings() ? 'Go to Team Dashboard to add reviews.' : 'No employee ratings have been created yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredRatings.map((rating) => (
            <div key={rating._id} className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-start space-x-4">
                  <div className="w-12 h-12 bg-primary-500 rounded-full flex items-center justify-center text-white font-semibold overflow-hidden">
                    {rating.employee.profilePicture ? (
                      <img src={rating.employee.profilePicture} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span>{rating.employee.firstName.charAt(0)}{rating.employee.lastName.charAt(0)}</span>
                    )}
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">
                      {rating.employee.firstName} {rating.employee.lastName}
                    </h3>
                    <p className="text-sm text-gray-500">{rating.employee.employeeCode}</p>
                    <p className="text-sm text-gray-600">{rating.employee.department}</p>
                    <p className="text-xs text-gray-400 mt-1 capitalize">{rating.type} • {rating.category}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="text-right">
                    {rating.rating > 0 && (
                      <div className="flex items-center space-x-2 mb-1">
                        <div className="flex">{getRatingStars(rating.rating)}</div>
                        <span className={`text-lg font-bold ${getRatingColor(rating.rating)}`}>
                          {rating.rating}
                        </span>
                      </div>
                    )}
                    <span className="text-xs text-gray-500">
                      {new Date(rating.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mb-4 bg-gray-50 p-4 rounded-lg">
                <p className="text-gray-700 whitespace-pre-wrap">{rating.content}</p>
              </div>

              <div className="flex justify-between items-center text-sm text-gray-500 pt-3 border-t border-gray-100">
                <div className="flex items-center space-x-2">
                  <span>Rated by:</span>
                  <span className="font-medium text-gray-700">
                    {rating.rater.firstName} {rating.rater.lastName}
                  </span>
                </div>
                {canManageRatings() && (
                  <button
                    onClick={() => router.push(`/dashboard/team/members/${rating.employee._id}`)}
                    className="text-primary-600 hover:text-primary-800 text-xs font-medium"
                  >
                    View Profile
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
