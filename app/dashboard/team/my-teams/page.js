'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Skeleton, Avatar, Chip } from '@heroui/react'
import {
  FaUsers, FaSearch, FaEnvelope, FaPhone, FaCalendarAlt,
  FaBriefcase, FaChartLine, FaArrowLeft, FaUserFriends, FaCrown, FaBuilding
} from 'react-icons/fa'
import { HiOutlineUserGroup } from 'react-icons/hi2'
import { formatDesignation } from '@/lib/formatters'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'

export default function MyTeamsPage() {
  const router = useRouter()
  const [selectedTeamId, setSelectedTeamId] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')

  const user = useMemo(() => {
    if (typeof window === 'undefined') return null
    try { return JSON.parse(localStorage.getItem('user')) } catch { return null }
  }, [])

  // Fetch the user's employee ID
  const { data: profileRes } = useAuthedSWR(user ? '/api/profile' : null)
  const employeeId = profileRes?.data?.employee?._id || profileRes?.data?.employeeId

  // Fetch teams the user leads
  const { data: teamsRes, error: teamsError, isLoading: teamsLoading, isValidating } = useAuthedSWR(
    employeeId ? `/api/teams/by-user/${employeeId}` : null
  )
  const teamsData = teamsRes?.data
  const leadingTeams = teamsData?.leading || []

  // Fetch members for the selected team
  const { data: teamDetailRes, isLoading: teamDetailLoading } = useAuthedSWR(
    selectedTeamId ? `/api/teams/${selectedTeamId}` : null
  )
  const selectedTeam = teamDetailRes?.data

  // Build the combined members + leaders list from the selected team
  const teamMembers = useMemo(() => {
    if (!selectedTeam) return []
    const memberMap = new Map()

    // Add leaders first
    for (const leader of (selectedTeam.teamLeaders || [])) {
      if (leader?._id) {
        memberMap.set(leader._id.toString(), { ...leader, isTeamLeader: true })
      }
    }
    // Add members
    for (const member of (selectedTeam.members || [])) {
      if (member?._id && !memberMap.has(member._id.toString())) {
        memberMap.set(member._id.toString(), member)
      }
    }

    return [...memberMap.values()].sort((a, b) =>
      (a.firstName || '').localeCompare(b.firstName || '')
    )
  }, [selectedTeam])

  const filteredMembers = useMemo(() => {
    if (!searchTerm) return teamMembers
    const searchLower = searchTerm.toLowerCase()
    return teamMembers.filter(member =>
      member.firstName?.toLowerCase().includes(searchLower) ||
      member.lastName?.toLowerCase().includes(searchLower) ||
      member.employeeCode?.toLowerCase().includes(searchLower) ||
      member.email?.toLowerCase().includes(searchLower)
    )
  }, [teamMembers, searchTerm])

  const handleTeamSelect = (teamId) => {
    setSelectedTeamId(teamId)
    setSearchTerm('')
  }

  const handleBackToTeams = () => {
    setSelectedTeamId(null)
    setSearchTerm('')
  }

  // Loading state
  if (teamsLoading) {
    return (
      <div className="px-4 py-4 sm:p-6 lg:p-8 pb-14 md:pb-6">
        <div className="mb-6">
          <Skeleton className="h-10 w-48 rounded-lg mb-2" />
          <Skeleton className="h-5 w-72 rounded-lg" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (teamsError) {
    return (
      <div className="px-4 py-4 sm:p-6 lg:p-8 pb-14 md:pb-6">
        <DataErrorState message="Failed to load your teams" />
      </div>
    )
  }

  if (leadingTeams.length === 0) {
    return (
      <div className="px-4 py-4 sm:p-6 lg:p-8 pb-14 md:pb-6">
        <div className="flex items-center mb-6">
          <HiOutlineUserGroup className="text-primary-500 mr-3 text-3xl" />
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">My Teams</h1>
        </div>
        <div className="bg-white rounded-xl shadow-md p-8 text-center">
          <FaUserFriends className="text-gray-300 text-5xl mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-700 mb-2">No Teams Found</h3>
          <p className="text-gray-500">You are not leading any teams yet.</p>
        </div>
      </div>
    )
  }

  // If a team is selected, show the member list
  if (selectedTeamId) {
    const currentTeam = leadingTeams.find(t => t._id === selectedTeamId)

    return (
      <div className="px-4 py-4 sm:p-6 lg:p-8 pb-14 md:pb-6">
        {/* Back button + Header */}
        <div className="mb-6">
          <button
            onClick={handleBackToTeams}
            className="flex items-center text-primary-600 hover:text-primary-700 mb-3 transition-colors"
          >
            <FaArrowLeft className="mr-2" />
            <span className="font-medium">Back to My Teams</span>
          </button>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center">
              <FaUserFriends className="text-primary-600 text-xl" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
                {currentTeam?.teamName || selectedTeam?.teamName || 'Team'}
              </h1>
              <div className="flex items-center gap-2 text-sm text-gray-500">
                {(currentTeam?.department?.name || selectedTeam?.department?.name) && (
                  <span className="flex items-center gap-1">
                    <FaBuilding className="text-xs" />
                    {currentTeam?.department?.name || selectedTeam?.department?.name}
                  </span>
                )}
                <span>•</span>
                <span>{teamMembers.length} member{teamMembers.length !== 1 ? 's' : ''}</span>
              </div>
            </div>
          </div>
          <BackgroundRefreshIndicator isValidating={isValidating} className="mt-2" />
        </div>

        {/* Search */}
        {teamMembers.length > 0 && (
          <div className="bg-white rounded-lg shadow-md p-4 mb-6">
            <div className="input-with-icon">
              <FaSearch className="input-icon" />
              <input
                type="text"
                placeholder="Search by name, employee code, or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input input-search"
              />
            </div>
          </div>
        )}

        {/* Members */}
        {teamDetailLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {[...Array(4)].map((_, i) => (
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
            <h3 className="text-lg font-semibold text-gray-700 mb-2">No Members Found</h3>
            <p className="text-gray-600">
              {searchTerm ? 'Try adjusting your search' : 'This team has no members yet'}
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
                    <div className="w-16 h-16 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 font-bold text-xl">
                      {member.profilePicture ? (
                        <img
                          src={member.profilePicture}
                          alt={`${member.firstName} ${member.lastName}`}
                          className="w-16 h-16 rounded-full object-cover"
                        />
                      ) : (
                        `${(member.firstName || '').charAt(0)}${(member.lastName || '').charAt(0)}`
                      )}
                    </div>
                    {member.isTeamLeader && (
                      <div className="absolute -top-1 -right-1 w-6 h-6 bg-primary-500 rounded-full flex items-center justify-center" title="Team Leader">
                        <FaCrown className="text-white text-xs" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 ml-4">
                    <h3 className="text-lg font-bold text-gray-900">
                      {member.firstName} {member.lastName}
                    </h3>
                    <p className="text-sm text-gray-600">{member.employeeCode}</p>
                    {member.isTeamLeader && (
                      <span className="inline-block mt-1 px-2 py-0.5 bg-primary-100 text-primary-800 text-xs rounded-full font-medium">
                        Team Leader
                      </span>
                    )}
                  </div>
                </div>

                {/* Details */}
                <div className="space-y-2 mb-4">
                  <div className="flex items-center text-sm text-gray-600">
                    <FaBriefcase className="mr-2 text-gray-400 flex-shrink-0" />
                    <span className="truncate">
                      {formatDesignation(member.designation, member) || 'No designation'}
                    </span>
                  </div>
                  {member.email && (
                    <div className="flex items-center text-sm text-gray-600">
                      <FaEnvelope className="mr-2 text-gray-400 flex-shrink-0" />
                      <span className="truncate">{member.email}</span>
                    </div>
                  )}
                  {member.phone && (
                    <div className="flex items-center text-sm text-gray-600">
                      <FaPhone className="mr-2 text-gray-400 flex-shrink-0" />
                      <span>{member.phone}</span>
                    </div>
                  )}
                  {member.department?.name && (
                    <div className="flex items-center text-sm text-gray-600">
                      <FaBuilding className="mr-2 text-gray-400 flex-shrink-0" />
                      <span>{member.department.name}</span>
                    </div>
                  )}
                </div>

                {/* View Details Button */}
                <button className="w-full px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors flex items-center justify-center">
                  <FaChartLine className="mr-2" />
                  View Details
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Default: Show team selection cards
  return (
    <div className="px-4 py-4 sm:p-6 lg:p-8 pb-14 md:pb-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center mb-2">
          <HiOutlineUserGroup className="text-primary-500 mr-3 text-3xl" />
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">My Teams</h1>
            <p className="text-gray-600 text-sm sm:text-base">
              Select a team to view and manage its members
            </p>
          </div>
        </div>
        <BackgroundRefreshIndicator isValidating={isValidating} className="mt-2" />
      </div>

      {/* Summary */}
      <div className="bg-white rounded-xl shadow-md p-4 sm:p-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600 font-medium">Teams You Lead</p>
            <p className="text-3xl font-bold text-gray-900">{leadingTeams.length}</p>
          </div>
          <div className="w-14 h-14 bg-primary-100 rounded-xl flex items-center justify-center">
            <FaUserFriends className="text-primary-500 text-2xl" />
          </div>
        </div>
      </div>

      {/* Team Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {leadingTeams.map((team) => (
          <div
            key={team._id}
            onClick={() => handleTeamSelect(team._id)}
            className="bg-white rounded-xl shadow-md hover:shadow-xl transition-all cursor-pointer border-2 border-transparent hover:border-primary-300 group"
          >
            {/* Team Color Header */}
            <div className="bg-gradient-to-r from-primary-500 to-primary-600 rounded-t-xl p-4">
              <div className="flex items-center justify-between">
                <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
                  <FaUserFriends className="text-white text-lg" />
                </div>
                {team.isCrossDepartment && (
                  <Chip size="sm" variant="flat" className="bg-white/20 text-white text-xs">
                    Cross-Dept
                  </Chip>
                )}
              </div>
            </div>

            {/* Team Details */}
            <div className="p-4 sm:p-5">
              <h3 className="text-lg font-bold text-gray-900 mb-1 group-hover:text-primary-600 transition-colors">
                {team.teamName}
              </h3>
              <p className="text-sm text-gray-500 mb-3">{team.teamCode}</p>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <FaBuilding className="text-gray-400" />
                  <span>{team.department?.name || 'Unknown'}</span>
                </div>

                <div className="flex items-center gap-1 text-sm text-gray-600">
                  <FaUsers className="text-gray-400" />
                  <span>{(team.members?.length || 0)} member{(team.members?.length || 0) !== 1 ? 's' : ''}</span>
                </div>
              </div>

              {/* View Team Button */}
              <div className="mt-4 pt-3 border-t border-gray-100">
                <div className="flex items-center justify-center text-primary-600 font-medium text-sm group-hover:text-primary-700 transition-colors">
                  <span>View Team Members</span>
                  <svg className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
