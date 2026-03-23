'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { Select, SelectItem, Skeleton } from '@heroui/react'
import {
  FaUsers, FaSearch, FaUser, FaEnvelope, FaPhone, FaCalendarAlt,
  FaBriefcase, FaStar, FaChartLine, FaFilter, FaCrown, FaUserFriends
} from 'react-icons/fa'
import { formatDesignation } from '@/lib/formatters'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'

export default function TeamMembersPage() {
  const router = useRouter()
  const [selectedDepartment, setSelectedDepartment] = useState('all')
  const [selectedTeam, setSelectedTeam] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')

  // --- SWR data fetching ---
  const swrKey = (() => {
    let url = '/api/team/members'
    const params = []
    if (selectedDepartment && selectedDepartment !== 'all') params.push(`department=${selectedDepartment}`)
    if (selectedTeam && selectedTeam !== 'all') params.push(`team=${selectedTeam}`)
    if (params.length > 0) url += '?' + params.join('&')
    return url
  })()
  const { data: teamRes, error, isLoading, isValidating, mutate: refreshTeam } = useAuthedSWR(swrKey)
  const teamMembers = teamRes?.data || []
  const department = teamRes?.meta?.department || null
  const departments = teamRes?.meta?.departments || []

  // Fetch teams for selected department
  const teamsSwrKey = selectedDepartment && selectedDepartment !== 'all'
    ? `/api/teams?department=${selectedDepartment}`
    : departments.length === 1 ? `/api/teams?department=${departments[0]?._id}` : null
  const { data: teamsRes } = useAuthedSWR(teamsSwrKey)
  const teams = teamsRes?.data || []

  const filteredMembers = teamMembers.filter(member => {
    if (!searchTerm) return true
    const searchLower = searchTerm.toLowerCase()
    return (
      member.firstName.toLowerCase().includes(searchLower) ||
      member.lastName.toLowerCase().includes(searchLower) ||
      member.employeeCode.toLowerCase().includes(searchLower) ||
      member.email.toLowerCase().includes(searchLower)
    )
  })

  return (
    <div className="px-4 py-4 sm:p-6 lg:p-8 pb-14 md:pb-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center mb-2">
          <FaUsers className="text-blue-600 mr-3 text-2xl" />
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Team Members</h1>
            <p className="text-gray-600 text-sm sm:text-base">
              {selectedDepartment === 'all'
                ? (departments.length > 1 ? 'All Departments' : department?.name + ' Department')
                : departments.find(d => d._id === selectedDepartment)?.name + ' Department'}
            </p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600 font-medium">Total Team Members</p>
            <p className="text-3xl font-bold text-gray-900">{teamMembers.length}</p>
          </div>
          <FaUsers className="text-blue-500 text-4xl" />
        </div>
      </div>

      {/* Search and Filter */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Search Input */}
          <div className="input-with-icon flex-1">
            <FaSearch className="input-icon" />
            <input
              type="text"
              placeholder="Search by name, employee code, or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input input-search"
            />
          </div>

          {/* Department Filter - show only if multiple departments */}
          {departments.length > 1 && (
            <div className="sm:w-64">
              <Select
                selectedKeys={[selectedDepartment]}
                onChange={(e) => { setSelectedDepartment(e.target.value); setSelectedTeam('all') }}
                aria-label="Department Filter"
                startContent={<FaFilter className="text-gray-400" />}
                classNames={{ trigger: "bg-white" }}
              >
                <SelectItem key="all">All Departments</SelectItem>
                {departments.map((dept) => (
                  <SelectItem key={dept._id}>
                    {dept.name}
                  </SelectItem>
                ))}
              </Select>
            </div>
          )}

          {/* Team Filter - show when teams are available */}
          {teams.length > 0 && (
            <div className="sm:w-64">
              <Select
                selectedKeys={[selectedTeam]}
                onChange={(e) => setSelectedTeam(e.target.value)}
                aria-label="Team Filter"
                startContent={<FaUserFriends className="text-gray-400" />}
                classNames={{ trigger: "bg-white" }}
              >
                <SelectItem key="all">All Teams</SelectItem>
                {teams.map((team) => (
                  <SelectItem key={team._id}>
                    {team.teamName}
                  </SelectItem>
                ))}
              </Select>
            </div>
          )}
        </div>
      </div>

      {/* Team Members List */}
      {error ? (
        <DataErrorState message="Failed to load team members" onRetry={() => refreshTeam()} />
      ) : isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg shadow-md p-6 space-y-3">
              <div className="flex items-center gap-3">
                <Skeleton className="w-12 h-12 rounded-full" />
                <div>
                  <Skeleton className="h-4 w-28 rounded-lg mb-1" />
                  <Skeleton className="h-3 w-20 rounded-lg" />
                </div>
              </div>
              <Skeleton className="h-3 w-3/4 rounded-lg" />
              <Skeleton className="h-3 w-1/2 rounded-lg" />
            </div>
          ))}
        </div>
      ) : filteredMembers.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-8 text-center">
          <FaUsers className="text-gray-400 text-4xl mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-700 mb-2">No Team Members Found</h3>
          <p className="text-gray-600">
            {searchTerm ? 'Try adjusting your search' : 'No team members in your department yet'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {filteredMembers.map((member) => (
            <div
              key={member._id}
              onClick={() => router.push(`/dashboard/team/members/${member._id}`)}
              className="bg-white rounded-lg shadow-md p-4 sm:p-6 cursor-pointer hover:shadow-lg transition-shadow"
            >
              {/* Profile Picture */}
              <div className="flex items-center mb-4">
                <div className="relative">
                  <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xl">
                    {member.profilePicture ? (
                      <img
                        src={member.profilePicture}
                        alt={`${member.firstName} ${member.lastName}`}
                        className="w-16 h-16 rounded-full object-cover"
                      />
                    ) : (
                      `${member.firstName.charAt(0)}${member.lastName.charAt(0)}`
                    )}
                  </div>
                  {member.isDepartmentHead && (
                    <div className="absolute -top-1 -right-1 w-6 h-6 bg-yellow-400 rounded-full flex items-center justify-center" title={`Head of ${member.headOfDepartment || 'Department'}`}>
                      <FaCrown className="text-white text-xs" />
                    </div>
                  )}
                </div>
                <div className="flex-1 ml-4">
                  <h3 className="text-lg font-bold text-gray-900">
                    {member.firstName} {member.lastName}
                  </h3>
                  <p className="text-sm text-gray-600">{member.employeeCode}</p>
                  {member.isDepartmentHead && (
                    <span className="inline-block mt-1 px-2 py-0.5 bg-yellow-100 text-yellow-800 text-xs rounded-full font-medium">
                      Dept Head{member.headOfDepartment ? ` - ${member.headOfDepartment}` : ''}
                    </span>
                  )}
                </div>
              </div>

              {/* Details */}
              <div className="space-y-2 mb-4">
                <div className="flex items-center text-sm text-gray-600">
                  <FaBriefcase className="mr-2 text-gray-400" />
                  <span>
                    {formatDesignation(member.designation, member) || 'No designation'}
                  </span>
                </div>
                <div className="flex items-center text-sm text-gray-600">
                  <FaEnvelope className="mr-2 text-gray-400" />
                  <span className="truncate">{member.email}</span>
                </div>
                <div className="flex items-center text-sm text-gray-600">
                  <FaPhone className="mr-2 text-gray-400" />
                  <span>{member.phone}</span>
                </div>
                <div className="flex items-center text-sm text-gray-600">
                  <FaCalendarAlt className="mr-2 text-gray-400" />
                  <span>Joined {new Date(member.dateOfJoining).toLocaleDateString()}</span>
                </div>
              </div>

              {/* Skills */}
              {member.skills && member.skills.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs text-gray-500 mb-2">Skills:</p>
                  <div className="flex flex-wrap gap-1">
                    {member.skills.slice(0, 3).map((skill, index) => (
                      <span
                        key={index}
                        className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded"
                      >
                        {skill}
                      </span>
                    ))}
                    {member.skills.length > 3 && (
                      <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded">
                        +{member.skills.length - 3} more
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* View Details Button */}
              <button className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center">
                <FaChartLine className="mr-2" />
                View Details & Reviews
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

