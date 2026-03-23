'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Select, SelectItem, Button, Card, CardBody, Tabs, Tab, Skeleton } from '@heroui/react'
import {
  HiOutlineComputerDesktop,
  HiOutlineCalendarDays,
  HiOutlineSparkles,
  HiOutlineChevronLeft,
  HiOutlineChevronRight,
  HiOutlineUsers,
  HiOutlineUser,
  HiOutlinePhoto,
  HiOutlineClock,
  HiOutlineXMark,
  HiOutlineArrowPath,
  HiOutlineCamera,
  HiOutlineSquares2X2,
  HiOutlineTrophy,
  HiOutlineChartBar,
  HiOutlineExclamationCircle,
  HiOutlineBuildingOffice2,
  HiOutlineClipboardDocumentList,
  HiOutlineEye,
  HiOutlineMagnifyingGlass,
  HiOutlineUserGroup
} from 'react-icons/hi2'
import RawCaptureViewer from '@/components/productivity/RawCaptureViewer'
import ManualCapturePanel from '@/components/productivity/ManualCapturePanel'
import { Modal, ModalContent, ModalHeader, ModalBody } from '@heroui/react'
import { useAILoading } from '@/contexts/AILoadingContext'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'

// Helper function to get screenshot URL (handles different field names)
const getScreenshotUrl = (screenshot) => {
  if (!screenshot) return null
  return screenshot.url || screenshot.path || screenshot.imagekitUrl || null
}

export default function ProductivityPage() {
  const [user, setUser] = useState(null)
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [sessions, setSessions] = useState([])
  const [teamSessions, setTeamSessions] = useState([])
  const [activeTab, setActiveTab] = useState('my')
  const [selectedSession, setSelectedSession] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [canViewTeam, setCanViewTeam] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [viewMode, setViewMode] = useState('sessions')
  const [selectedTeamMember, setSelectedTeamMember] = useState(null)
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0)
  const [selectedEmployee, setSelectedEmployee] = useState(null)
  const [employeeSessions, setEmployeeSessions] = useState([])
  const [loadingEmployeeSessions, setLoadingEmployeeSessions] = useState(false)
  const [departments, setDepartments] = useState([])
  const [selectedDepartment, setSelectedDepartment] = useState('all')
  const [selectedTeam, setSelectedTeam] = useState('all')
  const [teamSearchQuery, setTeamSearchQuery] = useState('')

  // Global AI loading animation
  const { startAILoading, stopAILoading } = useAILoading()

  // Get user from localStorage
  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      setUser(JSON.parse(userData))
    }
  }, [])

  const userRole = user?.role
  const [actualDepartmentHead, setActualDepartmentHead] = useState(false)
  const isDepartmentHead = user?.isDepartmentHead === true || actualDepartmentHead
  const isAdminOrHR = ['admin', 'hr'].includes(userRole)

  // Check if user is department head via API (more reliable than localStorage)
  const { data: deptHeadRes } = useAuthedSWR(user ? '/api/team/check-head' : null)
  useEffect(() => {
    if (deptHeadRes?.success && deptHeadRes.isDepartmentHead) {
      setActualDepartmentHead(true)
      if (deptHeadRes.departments?.length > 0) {
        setDepartments(deptHeadRes.departments)
      }
    }
  }, [deptHeadRes])

  const isTeamLeader = deptHeadRes?.success && deptHeadRes?.isTeamLeader

  // Check if user can view team (admin, hr, manager, dept_head, team_leader, or actual department head)
  // Admins default to team tab since screenshots are not captured for admin accounts
  useEffect(() => {
    const teamRoles = ['admin', 'hr', 'manager', 'department_head']
    const canView = teamRoles.includes(userRole) || isDepartmentHead || isTeamLeader
    setCanViewTeam(canView)
    if (userRole === 'admin') {
      setActiveTab('team')
    }
  }, [userRole, isDepartmentHead, isTeamLeader])

  // Fetch departments for admin/HR filter
  const { data: departmentsRes } = useAuthedSWR(isAdminOrHR ? '/api/departments' : null)
  useEffect(() => {
    if (departmentsRes?.data) {
      setDepartments(departmentsRes.data)
    }
  }, [departmentsRes])

  // Fetch teams for selected department
  const teamsFetchKey = (() => {
    if (selectedDepartment && selectedDepartment !== 'all') return `/api/teams?department=${selectedDepartment}`
    if (!isAdminOrHR && isDepartmentHead && departments.length === 1) return `/api/teams?department=${departments[0]?._id}`
    return null
  })()
  const { data: teamsRes } = useAuthedSWR(teamsFetchKey)
  const availableTeams = teamsRes?.data || []

  // Fetch sessions for selected date (SWR)
  const teamUrl = useMemo(() => {
    if (!canViewTeam) return null
    let url = `/api/productivity/team?date=${selectedDate}`
    if ((isAdminOrHR || isDepartmentHead) && selectedDepartment && selectedDepartment !== 'all') {
      url += `&department=${selectedDepartment}`
    }
    if (selectedTeam && selectedTeam !== 'all') {
      url += `&team=${selectedTeam}`
    }
    return url
  }, [canViewTeam, selectedDate, isAdminOrHR, isDepartmentHead, selectedDepartment, selectedTeam])

  const { data: sessionsRes, isLoading: sessionsLoading, isValidating: sessionsValidating, mutate: mutateSessions } = useAuthedSWR(`/api/productivity/sessions?date=${selectedDate}`)
  const { data: teamRes, isLoading: teamLoading, isValidating: teamValidating, mutate: mutateTeam } = useAuthedSWR(teamUrl)

  // Sync sessions from SWR to local state (needed for inline optimistic updates like analyzeSession)
  useEffect(() => {
    if (sessionsRes) {
      setSessions(sessionsRes.data || sessionsRes.sessions || [])
    }
  }, [sessionsRes])

  // Sync team sessions from SWR to local state
  useEffect(() => {
    if (teamRes) {
      const members = (teamRes.data || []).map(m => ({
        ...m,
        name: `${m.firstName || ''} ${m.lastName || ''}`.trim() || m.email,
        sessionCount: m.sessionsSummary?.totalSessions || 0,
        sessions: m.sessionsSummary?.sessions || []
      }))
      setTeamSessions(members)
      // For department heads, get departments from API response
      if (isDepartmentHead && !isAdminOrHR && teamRes.departments?.length > 0) {
        setDepartments(teamRes.departments)
      }
    }
  }, [teamRes, isDepartmentHead, isAdminOrHR])

  // Derive loading from SWR
  const loading = sessionsLoading

  // Create sessions from screenshots
  const refreshSessions = async () => {
    try {
      setRefreshing(true)
      await fetch('/api/productivity/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedDate })
      })
      await mutateSessions()
    } catch (error) {
      console.error('Error refreshing sessions:', error)
    } finally {
      setRefreshing(false)
    }
  }

  // Navigate date
  const changeDate = (direction) => {
    const date = new Date(selectedDate)
    date.setDate(date.getDate() + direction)
    setSelectedDate(date.toISOString().split('T')[0])
    // Reset selected employee when date changes
    if (selectedEmployee) {
      // Re-fetch employee sessions for new date
      fetchEmployeeSessions(selectedEmployee.userId, date.toISOString().split('T')[0])
    }
  }

  // Fetch sessions for a specific employee (for team view)
  const fetchEmployeeSessions = useCallback(async (userId, dateOverride) => {
    try {
      setLoadingEmployeeSessions(true)
      const targetDate = dateOverride || selectedDate
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/productivity/sessions?userId=${userId}&date=${targetDate}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      if (res.ok) {
        const data = await res.json()
        setEmployeeSessions(data.data || data.sessions || [])
      } else {
        const errorData = await res.json().catch(() => ({}))
        console.error('Failed to fetch employee sessions:', res.status, errorData)
        setEmployeeSessions([])
      }
    } catch (error) {
      console.error('Error fetching employee sessions:', error)
      setEmployeeSessions([])
    } finally {
      setLoadingEmployeeSessions(false)
    }
  }, [selectedDate])

  // Handle clicking on a team member card
  const handleSelectEmployee = (member) => {
    setSelectedEmployee(member)
    fetchEmployeeSessions(member.userId)
  }

  // Go back to team grid from employee sessions view
  const handleBackToTeam = () => {
    setSelectedEmployee(null)
    setEmployeeSessions([])
  }

  // Fetch full session data by ID (for team member sessions)
  const fetchSessionById = async (sessionId) => {
    try {
      // First try to get from local sessions
      const localSession = sessions.find(s => s._id === sessionId)
      if (localSession && localSession.screenshots?.length > 0) {
        setSelectedSession(localSession)
        setCurrentSlideIndex(0)
        return
      }

      // Fetch from API
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/productivity/sessions/${sessionId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      if (res.ok) {
        const data = await res.json()
        const session = data.data || data.session || data
        setSelectedSession(session)
        setCurrentSlideIndex(0)
      } else {
        console.error('Failed to fetch session:', sessionId)
      }
    } catch (error) {
      console.error('Error fetching session:', error)
    }
  }

  // Analyze session with AI
  const analyzeSession = async (sessionId) => {
    try {
      setAnalyzing(true)
      startAILoading('MIRA is analyzing your productivity session...')
      const res = await fetch(`/api/productivity/sessions/${sessionId}/analyze`, {
        method: 'POST'
      })
      const data = await res.json()
      console.log('[ProductivityUI] Analysis response:', {
        success: data.success,
        hasData: !!data.data,
        hasAnalysis: !!data.data?.analysis,
        responseKeys: data.data ? Object.keys(data.data) : []
      })
      if (res.ok && data.success) {
        // API returns { success, message, data: session }
        const updatedSession = data.data || data.session || data
        console.log('[ProductivityUI] Updated session:', {
          _id: updatedSession._id,
          isAnalyzed: updatedSession.analysis?.isAnalyzed,
          score: updatedSession.analysis?.score,
          summaryPreview: updatedSession.analysis?.summary?.substring(0, 100),
          achievements: updatedSession.analysis?.achievements,
          suggestions: updatedSession.analysis?.suggestions,
          insights: updatedSession.analysis?.insights
        })

        // Update the session in the list - compare as strings to handle ObjectId
        const sessionIdStr = sessionId.toString()
        setSessions(prev => {
          const updated = prev.map(s => {
            const sIdStr = (s._id || s.id || '').toString()
            if (sIdStr === sessionIdStr) {
              console.log('[ProductivityUI] Replacing session in list:', sIdStr)
              return updatedSession
            }
            return s
          })
          console.log('[ProductivityUI] Sessions updated, count:', updated.length)
          return updated
        })

        // Also update employeeSessions if viewing team member's sessions
        setEmployeeSessions(prev => {
          const updated = prev.map(s => {
            const sIdStr = (s._id || s.id || '').toString()
            if (sIdStr === sessionIdStr) {
              console.log('[ProductivityUI] Replacing employee session in list:', sIdStr)
              return updatedSession
            }
            return s
          })
          return updated
        })

        // Update selected session if it matches
        if (selectedSession) {
          const selectedIdStr = (selectedSession._id || selectedSession.id || '').toString()
          if (selectedIdStr === sessionIdStr) {
            console.log('[ProductivityUI] Updating selected session')
            setSelectedSession(updatedSession)
          }
        }
      } else {
        console.error('AI Analysis failed:', data.error || data.message)
        alert(`Analysis failed: ${data.error || data.message || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Error analyzing session:', error)
      alert('Analysis failed: Network error')
    } finally {
      setAnalyzing(false)
      stopAILoading()
    }
  }

  // Format time from timestamp
  const formatTime = (timestamp) => {
    if (!timestamp) return '--:--'
    const date = new Date(timestamp)
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }

  // Get score color
  const getScoreColor = (score) => {
    if (score >= 80) return 'text-green-600 bg-green-100'
    if (score >= 60) return 'text-yellow-600 bg-yellow-100'
    if (score >= 40) return 'text-orange-600 bg-orange-100'
    return 'text-red-600 bg-red-100'
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <HiOutlineComputerDesktop className="w-7 h-7 text-primary-600" />
            Productivity
          </h1>
          <p className="text-gray-600 mt-1">
            Monitor your work activity
          </p>
          <BackgroundRefreshIndicator isRefreshing={sessionsValidating || teamValidating} />
        </div>

        {/* Date Navigation */}
        <div className="flex items-center gap-2 bg-white rounded-xl shadow-sm border px-2 py-1">
          <button
            onClick={() => changeDate(-1)}
            className="p-2 hover:bg-gray-100 rounded-lg transition"
          >
            <HiOutlineChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 px-3">
            <HiOutlineCalendarDays className="w-5 h-5 text-gray-400" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              max={new Date().toISOString().split('T')[0]}
              className="border-0 focus:ring-0 text-sm font-medium"
            />
          </div>
          <button
            onClick={() => changeDate(1)}
            disabled={selectedDate >= new Date().toISOString().split('T')[0]}
            className="p-2 hover:bg-gray-100 rounded-lg transition disabled:opacity-50"
          >
            <HiOutlineChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary-100 rounded-lg">
              <HiOutlineSquares2X2 className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{sessions.length}</p>
              <p className="text-sm text-gray-500">Sessions</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <HiOutlineChartBar className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">
                {sessions.filter(s => s.analysis?.isAnalyzed).length}
              </p>
              <p className="text-sm text-gray-500">Analyzed</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <HiOutlinePhoto className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">
                {sessions.reduce((acc, s) => acc + (s.screenshots?.length || 0), 0)}
              </p>
              <p className="text-sm text-gray-500">Captures</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-lg">
              <HiOutlineTrophy className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">
                {sessions.length > 0
                  ? Math.round(sessions.filter(s => s.analysis?.score).reduce((acc, s) => acc + (s.analysis?.score || 0), 0) / sessions.filter(s => s.analysis?.score).length) || '--'
                  : '--'}
              </p>
              <p className="text-sm text-gray-500">Avg Score</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs (if can view team) */}
      {canViewTeam && (
        <div className="bg-white rounded-lg shadow-md p-4 mb-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex gap-2 flex-1">
              {userRole !== 'admin' && (
                <button
                  onClick={() => {
                    setActiveTab('my')
                    // Reset viewMode if on manual capture (only available in team tab)
                    if (viewMode === 'manual') setViewMode('sessions')
                    // Reset selected team member
                    setSelectedTeamMember(null)
                    // Reset selected employee (sessions view)
                    setSelectedEmployee(null)
                    setEmployeeSessions([])
                  }}
                  className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition ${activeTab === 'my'
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                >
                  <HiOutlineUser className="w-5 h-5" />
                  My Activity
                </button>
              )}
              <button
                onClick={() => {
                  setActiveTab('team')
                  // Reset selected employee when switching to team tab
                  setSelectedEmployee(null)
                  setEmployeeSessions([])
                }}
                className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition ${activeTab === 'team'
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
              >
                <HiOutlineUsers className="w-5 h-5" />
                Team Activity
              </button>
            </div>

            {/* Department Filter for Admin/HR or Department Heads with multiple departments */}
            {(isAdminOrHR || (isDepartmentHead && departments.length > 1)) && activeTab === 'team' && departments.length > 0 && (
              <div className="flex items-center gap-2">
                <HiOutlineBuildingOffice2 className="w-5 h-5 text-gray-400" />
                <Select
                  selectedKeys={[selectedDepartment]}
                  onSelectionChange={(keys) => { setSelectedDepartment(Array.from(keys)[0]); setSelectedTeam('all') }}
                  className="min-w-[150px]"
                  size="sm"
                  aria-label="Filter by Department"
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

            {/* Team Filter */}
            {activeTab === 'team' && availableTeams.length > 0 && (
              <div className="flex items-center gap-2">
                <HiOutlineUserGroup className="w-5 h-5 text-gray-400" />
                <Select
                  selectedKeys={[selectedTeam]}
                  onSelectionChange={(keys) => setSelectedTeam(Array.from(keys)[0])}
                  className="min-w-[150px]"
                  size="sm"
                  aria-label="Filter by Team"
                >
                  <SelectItem key="all">All Teams</SelectItem>
                  {availableTeams.map((team) => (
                    <SelectItem key={team._id}>
                      {team.teamName}
                    </SelectItem>
                  ))}
                </Select>
              </div>
            )}
          </div>
        </div>
      )}

      {/* View Mode Tabs */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode('sessions')}
            className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition ${viewMode === 'sessions'
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
          >
            <HiOutlineSquares2X2 className="w-5 h-5" />
            Sessions
          </button>
          <button
            onClick={() => setViewMode('raw')}
            className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition ${viewMode === 'raw'
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
          >
            <HiOutlinePhoto className="w-5 h-5" />
            Raw Captures
          </button>
          {canViewTeam && activeTab === 'team' && (
            <button
              onClick={() => setViewMode('manual')}
              className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition ${viewMode === 'manual'
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
            >
              <HiOutlineCamera className="w-5 h-5" />
              Manual Capture
            </button>
          )}
        </div>
      </div>

      {/* Raw Capture View */}
      {viewMode === 'raw' && (
        <>
          {/* Team member selector for team tab */}
          {activeTab === 'team' && canViewTeam && (
            <div className="bg-white rounded-lg shadow-md p-4 mb-6">
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-gray-700">View captures for:</label>
                <Select
                  selectedKeys={selectedTeamMember ? [selectedTeamMember] : []}
                  onSelectionChange={(keys) => setSelectedTeamMember(Array.from(keys)[0] || null)}
                  className="min-w-[200px]"
                  size="sm"
                  placeholder="Select team member"
                  aria-label="Select Team Member"
                >
                  {teamSessions.map((member) => (
                    <SelectItem key={member.userId || member._id}>
                      {member.name || `${member.firstName || ''} ${member.lastName || ''}`.trim() || member.email}
                    </SelectItem>
                  ))}
                </Select>
              </div>
            </div>
          )}
          {/* Show raw captures - for my tab or when team member is selected */}
          {(activeTab === 'my' || (activeTab === 'team' && selectedTeamMember)) ? (
            <RawCaptureViewer
              date={selectedDate}
              showFilters={true}
              userId={activeTab === 'team' ? selectedTeamMember : null}
            />
          ) : activeTab === 'team' && !selectedTeamMember ? (
            <div className="text-center py-12 bg-white rounded-xl shadow-sm border border-gray-100">
              <HiOutlineUsers className="w-16 h-16 mx-auto text-gray-300 mb-4" />
              <h3 className="text-lg font-medium text-gray-800 mb-2">Select a team member</h3>
              <p className="text-gray-500">
                Choose a team member from the dropdown above to view their raw captures.
              </p>
            </div>
          ) : null}
        </>
      )}

      {/* Manual Capture View */}
      {viewMode === 'manual' && canViewTeam && (
        <ManualCapturePanel />
      )}

      {/* My Activity Tab - Sessions View */}
      {activeTab === 'my' && viewMode === 'sessions' && (
        <>
          {/* Refresh Button */}
          <div className="flex justify-end mb-6">
            <button
              onClick={refreshSessions}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition font-medium text-gray-700"
            >
              <HiOutlineArrowPath className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing...' : 'Refresh Sessions'}
            </button>
          </div>

          {/* Sessions Grid */}
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-48 rounded-xl" />
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-xl shadow-sm border border-gray-100">
              <HiOutlinePhoto className="w-16 h-16 mx-auto text-gray-300 mb-4" />
              <h3 className="text-lg font-medium text-gray-800 mb-2">No activity recorded</h3>
              <p className="text-gray-500 mb-4">
                No screenshots were captured on this date. Make sure the desktop app is running while clocked in.
              </p>
              <Button
                onPress={refreshSessions}
                color="primary"
              >
                Check for Screenshots
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sessions.map((session, index) => {
                // Calculate session number: oldest = 1, latest = highest number
                // Since sessions are sorted latest first (index 0 = latest), reverse the numbering
                const sessionNumber = sessions.length - index

                return (
                  <div
                    key={session._id}
                    className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition cursor-pointer"
                    onClick={() => {
                      setSelectedSession(session)
                      setCurrentSlideIndex(0)
                    }}
                  >
                    {/* Session Preview - Show analysis complete state or screenshot */}
                    <div className="aspect-video bg-gray-100 relative">
                      {session.analysis?.isAnalyzed || session.screenshotsDeleted ? (
                        // Show "Analysis Complete" preview for analyzed sessions
                        <div className="flex flex-col items-center justify-center h-full bg-gradient-to-br from-primary-500 to-primary-700 text-white">
                          <HiOutlineSparkles className="w-10 h-10 mb-2" />
                          <span className="font-medium">Analysis Complete</span>
                          {session.analysis?.score != null && (
                            <span className="text-2xl font-bold mt-1">{session.analysis.score}%</span>
                          )}
                        </div>
                      ) : getScreenshotUrl(session.screenshots?.[0]) ? (
                        <img
                          src={getScreenshotUrl(session.screenshots[0])}
                          alt="Session preview"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="flex items-center justify-center h-full">
                          <HiOutlinePhoto className="w-12 h-12 text-gray-300" />
                        </div>
                      )}
                      {/* Screenshot count badge - only show if not analyzed */}
                      {!session.analysis?.isAnalyzed && !session.screenshotsDeleted && (
                        <div className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded-full flex items-center gap-1">
                          <HiOutlinePhoto className="w-3 h-3" />
                          {session.screenshots?.length || 0}
                        </div>
                      )}
                      {/* Ongoing badge for latest session */}
                      {index === 0 && !session.analysis?.isAnalyzed && (
                        <div className="absolute top-2 left-2 bg-green-500 text-white text-xs px-2 py-1 rounded-full">
                          Latest
                        </div>
                      )}
                    </div>

                    {/* Session Info */}
                    <div className="p-4">
                      <div className="flex items-center justify-start mb-2">
                        <h3 className="font-medium text-gray-800">
                          {session.sessionTitle || `Session ${sessionNumber}`}
                        </h3>
                        {session.analysis?.score != null && !session.analysis?.isAnalyzed && (
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getScoreColor(session.analysis.score)}`}>
                            {session.analysis.score}%
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-gray-500 mb-2">
                        <span className="flex items-center gap-1">
                          <HiOutlineClock className="w-4 h-4" />
                          <span className="truncate">{formatTime(session.startTime)} - {formatTime(session.endTime)}</span>
                        </span>
                      </div>

                      {/* Show analysis results if analyzed */}
                      {session.analysis?.isAnalyzed ? (
                        <div className="space-y-2">
                          {/* Summary Preview */}
                          {session.analysis.summary && (
                            <p className="text-sm text-gray-600 line-clamp-2">
                              {session.analysis.summary}
                            </p>
                          )}

                          {/* Quick stats */}
                          <div className="flex flex-wrap gap-2">
                            {session.analysis.achievements?.length > 0 && (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-50 text-green-700 rounded text-xs">
                                <HiOutlineTrophy className="w-3 h-3" />
                                {session.analysis.achievements.length} wins
                              </span>
                            )}
                            {(session.analysis.suggestions?.length > 0 || session.analysis.improvements?.length > 0) && (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 text-amber-700 rounded text-xs">
                                💡 {(session.analysis.suggestions?.length || 0) + (session.analysis.improvements?.length || 0)} tips
                              </span>
                            )}
                            {session.analysis.insights?.length > 0 && (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs">
                                📊 {session.analysis.insights.length} insights
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500 mt-2">
                          Not analyzed yet
                        </p>
                      )}

                      {/* View Button - Always visible */}
                      <button
                        className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-primary-600 to-primary-700 text-white rounded-lg font-medium hover:opacity-90 transition"
                      >
                        <HiOutlineEye className="w-5 h-5" />
                        View Session
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Team Activity Tab */}
      {activeTab === 'team' && viewMode === 'sessions' && (
        <div>
          {/* Show selected employee's sessions or team grid */}
          {selectedEmployee ? (
            /* Selected Employee's Sessions View */
            <>
              {/* Back button and employee header */}
              <div className="mb-6 flex items-center gap-4">
                <button
                  onClick={handleBackToTeam}
                  className="flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition font-medium text-gray-700"
                >
                  <HiOutlineChevronLeft className="w-5 h-5" />
                  Back to Team
                </button>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-primary-700 rounded-full flex items-center justify-center text-white font-semibold shadow-lg">
                    {selectedEmployee.name?.charAt(0) || selectedEmployee.firstName?.charAt(0) || 'U'}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-800">{selectedEmployee.name || `${selectedEmployee.firstName} ${selectedEmployee.lastName}`}</h3>
                    <p className="text-sm text-gray-500">{selectedEmployee.designation || selectedEmployee.department || 'Team Member'}</p>
                  </div>
                </div>
              </div>

              {/* Employee Sessions Grid */}
              {loadingEmployeeSessions ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-48 rounded-xl" />
                  ))}
                </div>
              ) : employeeSessions.length === 0 ? (
                <div className="text-center py-12 bg-white rounded-xl shadow-sm border border-gray-100">
                  <HiOutlinePhoto className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                  <h3 className="text-lg font-medium text-gray-800 mb-2">No activity recorded</h3>
                  <p className="text-gray-500">
                    {selectedEmployee.name || 'This employee'} has no screenshots on this date.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {employeeSessions.map((session, index) => {
                    // Calculate session number: oldest = 1, latest = highest number
                    // Since sessions are sorted latest first (index 0 = latest), reverse the numbering
                    const sessionNumber = employeeSessions.length - index

                    return (
                      <div
                        key={session._id}
                        onClick={() => {
                          setSelectedSession(session)
                          setCurrentSlideIndex(0)
                        }}
                        className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-all duration-200 cursor-pointer group"
                      >
                        {/* Session Header */}
                        <div className="p-4 border-b">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-primary-700 rounded-lg flex items-center justify-center text-white font-bold">
                                {sessionNumber}
                              </div>
                              <div>
                                <h3 className="font-semibold text-gray-800">
                                  {session.sessionTitle || `Session ${sessionNumber}`}
                                </h3>
                                <p className="text-sm text-gray-500">
                                  {formatTime(session.startTime)} - {formatTime(session.endTime)}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {index === 0 && !session.analysis?.isAnalyzed && (
                                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Latest</span>
                              )}
                              <span className="text-sm text-gray-400">{session.screenshotCount || session.screenshots?.length || 0} screenshots</span>
                            </div>
                          </div>
                        </div>

                        {/* Preview Screenshots */}
                        <div className="p-4">
                          {session.screenshotsDeleted || session.analysis?.isAnalyzed ? (
                            <div className="aspect-video bg-primary-50 dark:bg-primary-950/30 rounded-lg flex items-center justify-center">
                              <div className="text-center">
                                <HiOutlineSparkles className="w-8 h-8 text-primary-400 mx-auto mb-2" />
                                <p className="text-sm text-primary-600 font-medium">Analysis Complete</p>
                              </div>
                            </div>
                          ) : session.screenshots?.length > 0 ? (
                            <div className="grid grid-cols-3 gap-2">
                              {session.screenshots.slice(0, 3).map((ss, i) => (
                                <div key={i} className="aspect-video bg-gray-100 rounded overflow-hidden">
                                  <img
                                    src={getScreenshotUrl(ss)}
                                    alt={`Screenshot ${i + 1}`}
                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                    loading="lazy"
                                  />
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="aspect-video bg-gray-50 rounded-lg flex items-center justify-center">
                              <HiOutlinePhoto className="w-8 h-8 text-gray-300" />
                            </div>
                          )}
                        </div>

                        {/* Analysis Status / Actions */}
                        <div className="p-4 border-t bg-gray-50">
                          {session.analysis?.isAnalyzed ? (
                            <div className="flex items-center gap-2 mb-2">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${getScoreColor(session.analysis.score)}`}>
                                {session.analysis.score}%
                              </span>
                              <span className="text-sm text-gray-500">productivity score</span>
                            </div>
                          ) : (
                            <p className="text-sm text-gray-500 mb-2">
                              Not analyzed yet
                            </p>
                          )}

                          {/* View Button - Always visible */}
                          <button
                            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-primary-600 to-primary-700 text-white rounded-lg font-medium hover:opacity-90 transition"
                          >
                            <HiOutlineEye className="w-5 h-5" />
                            View Session
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          ) : teamLoading ? (
            /* Loading skeleton for team grid */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <Skeleton className="h-32 w-full" />
                  <div className="p-4 space-y-3">
                    <Skeleton className="h-4 w-3/4 rounded-lg" />
                    <Skeleton className="h-3 w-1/2 rounded-lg" />
                    <Skeleton className="h-8 w-full rounded-lg" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Team Grid View */
            <>
              {/* Search Box */}
              <div className="mb-6">
                <div className="input-with-icon max-w-md">
                  <HiOutlineMagnifyingGlass className="input-icon w-5 h-5" />
                  <input
                    type="text"
                    placeholder="Search employees by name, email, or department..."
                    value={teamSearchQuery}
                    onChange={(e) => setTeamSearchQuery(e.target.value)}
                    className="input input-search"
                  />
                  {teamSearchQuery && (
                    <button
                      onClick={() => setTeamSearchQuery('')}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <HiOutlineXMark className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </div>

              {(() => {
                // Filter team sessions based on search query
                const filteredTeamSessions = teamSessions.filter((member) => {
                  if (!teamSearchQuery.trim()) return true;
                  const query = teamSearchQuery.toLowerCase();
                  const name = (member.name || `${member.firstName || ''} ${member.lastName || ''}`).toLowerCase();
                  const email = (member.email || '').toLowerCase();
                  const designation = (member.designation || '').toLowerCase();
                  const department = (member.department || '').toLowerCase();
                  return name.includes(query) || email.includes(query) || designation.includes(query) || department.includes(query);
                });

                return filteredTeamSessions.length === 0 ? (
                  <div className="text-center py-12 bg-white rounded-xl shadow-sm border border-gray-100">
                    <HiOutlineUsers className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                    <h3 className="text-lg font-medium text-gray-800 mb-2">
                      {teamSearchQuery ? 'No matching employees' : 'No team activity'}
                    </h3>
                    <p className="text-gray-500">
                      {teamSearchQuery
                        ? `No employees match "${teamSearchQuery}". Try a different search term.`
                        : 'No team members have recorded activity on this date.'}
                    </p>
                    {teamSearchQuery && (
                      <button
                        onClick={() => setTeamSearchQuery('')}
                        className="mt-4 px-4 py-2 text-primary-600 hover:text-primary-700 font-medium"
                      >
                        Clear search
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {filteredTeamSessions.map((member) => {
                      // Get sessions from sessionsSummary
                      const memberSessions = member.sessionsSummary?.sessions || [];
                      const firstSession = memberSessions[0];
                      const previewUrl = firstSession?.previewUrl || getScreenshotUrl(firstSession?.screenshots?.[0]);

                      return (
                        <div
                          key={member.userId}
                          className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
                          onClick={() => handleSelectEmployee(member)}
                        >
                          {/* Card Header with Profile */}
                          <div className="p-4 border-b bg-primary-50 dark:bg-primary-950/30">
                            <div className="flex items-center gap-3">
                              <div className="w-12 h-12 bg-gradient-to-br from-primary-500 to-primary-700 rounded-full flex items-center justify-center text-white text-lg font-semibold shadow-lg">
                                {member.name?.charAt(0) || member.firstName?.charAt(0) || 'U'}
                              </div>
                              <div className="min-w-0 flex-1">
                                <h3 className="font-semibold text-gray-800 truncate">{member.name || `${member.firstName} ${member.lastName}`}</h3>
                                <p className="text-sm text-gray-500">{member.designation || member.department || 'Team Member'}</p>
                              </div>
                            </div>
                          </div>

                          {/* Stats */}
                          <div className="p-4">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <HiOutlineSquares2X2 className="w-5 h-5 text-primary-500" />
                                <span className="font-medium text-gray-700">{member.sessionsSummary?.totalSessions || 0} Sessions</span>
                              </div>
                              {member.sessionsSummary?.averageScore && (
                                <div className="flex items-center gap-1">
                                  <HiOutlineTrophy className="w-5 h-5 text-amber-500" />
                                  <span className={`font-bold ${member.sessionsSummary.averageScore >= 70 ? 'text-green-600' :
                                      member.sessionsSummary.averageScore >= 40 ? 'text-amber-600' : 'text-red-600'
                                    }`}>
                                    {member.sessionsSummary.averageScore}%
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* Screenshot Preview */}
                            {previewUrl ? (
                              <div className="aspect-video bg-gray-100 rounded-lg overflow-hidden relative group">
                                <img
                                  src={previewUrl}
                                  alt="Latest activity"
                                  className="w-full h-full object-cover"
                                />
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                                  <span className="text-white font-medium">View Sessions</span>
                                </div>
                                {memberSessions.length > 1 && (
                                  <div className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded-full">
                                    +{memberSessions.length - 1} more
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="aspect-video bg-gray-50 rounded-lg flex items-center justify-center">
                                <div className="text-center">
                                  <HiOutlinePhoto className="w-8 h-8 text-gray-300 mx-auto mb-1" />
                                  <p className="text-sm text-gray-400">No screenshots</p>
                                </div>
                              </div>
                            )}

                            {/* Quick Stats Bar */}
                            <div className="mt-3 flex items-center justify-between text-sm text-gray-500">
                              <span>{member.sessionsSummary?.totalScreenshots || 0} screenshots</span>
                              <span>{member.sessionsSummary?.analyzedSessions || 0} analyzed</span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                );
              })()}
            </>
          )}
        </div>
      )}

      {/* Session Detail Modal */}
      <Modal
        isOpen={!!selectedSession}
        onClose={() => { setSelectedSession(null); setCurrentSlideIndex(0); }}
        size="5xl"
        scrollBehavior="inside"
        radius="lg"
        classNames={{
          wrapper: 'z-[99999] flex items-center justify-center',
          backdrop: 'bg-black/50 backdrop-blur-[10px] animate-[overlay-blur-in_0.3s_cubic-bezier(0.16,1,0.3,1)_forwards]',
          base: '!rounded-[30px] !max-w-none !max-h-none m-0',
          body: 'rounded-b-[30px]',
          header: 'rounded-t-[30px]',
          closeButton: 'top-3 right-3 z-50'
        }}
      >
        <ModalContent className="!rounded-[30px] overflow-hidden" style={{ width: '80vw', height: '85vh', maxWidth: '80vw', maxHeight: '85vh' }}>
          {selectedSession && (
            <>
              <ModalHeader className="flex items-center justify-between border-b bg-default-50 pr-12">
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-bold text-default-800">
                    {selectedSession.sessionTitle || `Session ${selectedSession.sessionNumber || 1}`}
                  </h2>
                  <p className="text-sm text-default-500">
                    {formatTime(selectedSession.startTime)} - {formatTime(selectedSession.endTime)}
                    {selectedSession.analysis?.isAnalyzed ? (
                      <span> • <span className="text-primary-600 font-medium">AI Analyzed</span></span>
                    ) : (
                      <span> • {selectedSession.screenshots?.length || 0} screenshots</span>
                    )}
                  </p>
                </div>
              </ModalHeader>

              {/* Modal Content - 40-60 Split */}
              <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
                {/* Left Side - Screenshots Slider (40%) */}
                <div className="lg:w-[40%] bg-gray-900 flex flex-col">
                  {/* Main Screenshot */}
                  <div className="flex-1 relative flex items-center justify-center p-4 min-h-[200px] lg:min-h-0">
                    {/* Show message if screenshots were deleted after analysis */}
                    {selectedSession.screenshotsDeleted || selectedSession.analysis?.isAnalyzed ? (
                      <div className="text-center text-gray-400 p-6">
                        <div className="w-20 h-20 bg-gray-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
                          <HiOutlineSparkles className="w-10 h-10 text-primary-400" />
                        </div>
                        <h3 className="text-lg font-semibold text-white mb-2">Analysis Complete</h3>
                        <p className="text-sm text-gray-400 max-w-xs mx-auto">
                          Screenshots have been processed and removed to save storage.
                          The AI analysis results are preserved.
                        </p>
                        {selectedSession.screenshotCount > 0 && (
                          <p className="text-xs text-gray-500 mt-3">
                            Originally {selectedSession.screenshotCount || selectedSession.screenshots?.length || 0} screenshots
                          </p>
                        )}
                      </div>
                    ) : selectedSession.screenshots?.length > 0 && getScreenshotUrl(selectedSession.screenshots[currentSlideIndex]) ? (
                      <>
                        <img
                          src={getScreenshotUrl(selectedSession.screenshots[currentSlideIndex])}
                          alt={`Screenshot ${currentSlideIndex + 1}`}
                          className="max-w-full max-h-full object-contain rounded-lg shadow-2xl cursor-pointer"
                          onClick={() => window.open(getScreenshotUrl(selectedSession.screenshots[currentSlideIndex]), '_blank')}
                        />

                        {/* Navigation Arrows */}
                        {selectedSession.screenshots.length > 1 && (
                          <>
                            <button
                              onClick={() => setCurrentSlideIndex(prev => prev > 0 ? prev - 1 : selectedSession.screenshots.length - 1)}
                              className="absolute left-2 top-1/2 -translate-y-1/2 p-2 bg-white/20 hover:bg-white/40 rounded-full transition"
                            >
                              <HiOutlineChevronLeft className="w-5 h-5 text-white" />
                            </button>
                            <button
                              onClick={() => setCurrentSlideIndex(prev => prev < selectedSession.screenshots.length - 1 ? prev + 1 : 0)}
                              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-white/20 hover:bg-white/40 rounded-full transition"
                            >
                              <HiOutlineChevronRight className="w-5 h-5 text-white" />
                            </button>
                          </>
                        )}

                        {/* Slide Counter */}
                        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs px-3 py-1.5 rounded-full">
                          {currentSlideIndex + 1} / {selectedSession.screenshots.length}
                        </div>
                      </>
                    ) : (
                      <div className="text-center text-gray-400">
                        <HiOutlinePhoto className="w-16 h-16 mx-auto mb-2 opacity-50" />
                        <p>No screenshots available</p>
                      </div>
                    )}
                  </div>

                  {/* Thumbnail Strip - only show if screenshots exist and not deleted */}
                  {!selectedSession.screenshotsDeleted && !selectedSession.analysis?.isAnalyzed && selectedSession.screenshots?.length > 1 && getScreenshotUrl(selectedSession.screenshots[0]) && (
                    <div className="border-t border-gray-700 p-2 bg-gray-800">
                      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-gray-600">
                        {selectedSession.screenshots.map((screenshot, idx) => (
                          <button
                            key={idx}
                            onClick={() => setCurrentSlideIndex(idx)}
                            className={`flex-shrink-0 w-14 h-10 rounded overflow-hidden border-2 transition ${idx === currentSlideIndex ? 'border-primary-500' : 'border-transparent hover:border-gray-500'
                              }`}
                          >
                            <img
                              src={getScreenshotUrl(screenshot)}
                              alt={`Thumb ${idx + 1}`}
                              className="w-full h-full object-cover"
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Screenshot Time - only show if not deleted */}
                  {!selectedSession.screenshotsDeleted && !selectedSession.analysis?.isAnalyzed && selectedSession.screenshots?.[currentSlideIndex] && getScreenshotUrl(selectedSession.screenshots[currentSlideIndex]) && (
                    <div className="p-2 bg-gray-800 text-center border-t border-gray-700">
                      <p className="text-xs text-gray-400">
                        <HiOutlineClock className="w-3 h-3 inline mr-1" />
                        {formatTime(selectedSession.screenshots[currentSlideIndex].capturedAt)}
                      </p>
                    </div>
                  )}

                  {/* Analysis timestamp for analyzed sessions */}
                  {selectedSession.analysis?.isAnalyzed && selectedSession.analysis?.analyzedAt && (
                    <div className="p-2 bg-gray-800 text-center border-t border-gray-700">
                      <p className="text-xs text-gray-400">
                        <HiOutlineSparkles className="w-3 h-3 inline mr-1" />
                        Analyzed on {new Date(selectedSession.analysis.analyzedAt).toLocaleDateString()}
                      </p>
                    </div>
                  )}
                </div>

                {/* Right Side - AI Analysis (60%) */}
                <div className="lg:w-[60%] overflow-y-auto p-4 sm:p-6 bg-white">
                  {selectedSession.analysis?.isAnalyzed ? (
                    <div className="space-y-6">
                      {/* Score Header with Multiple Metrics */}
                      <div className="grid grid-cols-3 gap-3">
                        {/* Main Productivity Score */}
                        <div className={`p-3 rounded-xl text-center ${selectedSession.analysis.score >= 70 ? 'bg-green-50 border border-green-200' :
                            selectedSession.analysis.score >= 40 ? 'bg-amber-50 border border-amber-200' : 'bg-red-50 border border-red-200'
                          }`}>
                          <span className={`text-2xl font-bold ${selectedSession.analysis.score >= 70 ? 'text-green-600' :
                              selectedSession.analysis.score >= 40 ? 'text-amber-600' : 'text-red-600'
                            }`}>
                            {selectedSession.analysis.score || '--'}
                          </span>
                          <p className="text-xs text-gray-500 mt-1">Productivity</p>
                        </div>

                        {/* Focus Score */}
                        {selectedSession.analysis.focusScore != null && (
                          <div className={`p-3 rounded-xl text-center ${selectedSession.analysis.focusScore >= 70 ? 'bg-blue-50 border border-blue-200' :
                              selectedSession.analysis.focusScore >= 40 ? 'bg-amber-50 border border-amber-200' : 'bg-red-50 border border-red-200'
                            }`}>
                            <span className={`text-2xl font-bold ${selectedSession.analysis.focusScore >= 70 ? 'text-blue-600' :
                                selectedSession.analysis.focusScore >= 40 ? 'text-amber-600' : 'text-red-600'
                              }`}>
                              {selectedSession.analysis.focusScore}
                            </span>
                            <p className="text-xs text-gray-500 mt-1">Focus</p>
                          </div>
                        )}

                        {/* Task Completion */}
                        {selectedSession.analysis.taskCompletionIndicators != null && (
                          <div className={`p-3 rounded-xl text-center ${selectedSession.analysis.taskCompletionIndicators >= 70 ? 'bg-primary-50 border border-primary-200' :
                              selectedSession.analysis.taskCompletionIndicators >= 40 ? 'bg-amber-50 border border-amber-200' : 'bg-red-50 border border-red-200'
                            }`}>
                            <span className={`text-2xl font-bold ${selectedSession.analysis.taskCompletionIndicators >= 70 ? 'text-primary-600' :
                                selectedSession.analysis.taskCompletionIndicators >= 40 ? 'text-amber-600' : 'text-red-600'
                              }`}>
                              {selectedSession.analysis.taskCompletionIndicators}
                            </span>
                            <p className="text-xs text-gray-500 mt-1">Task Progress</p>
                          </div>
                        )}
                      </div>

                      {/* Summary */}
                      <div className="bg-primary-50 dark:bg-primary-950/30 rounded-xl p-4">
                        <h4 className="font-medium text-primary-900 mb-2 flex items-center gap-2">
                          <HiOutlineSparkles className="w-4 h-4" />
                          AI Summary
                        </h4>
                        <p className="text-sm text-gray-700 leading-relaxed">
                          {selectedSession.analysis.summary || 'No summary available'}
                        </p>
                      </div>

                      {/* Task Relativity */}
                      {selectedSession.analysis.taskRelativity && (
                        <div className="bg-violet-50 dark:bg-violet-950/30 rounded-xl p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="font-medium text-violet-900 flex items-center gap-2">
                              <HiOutlineClipboardDocumentList className="w-4 h-4" />
                              Task Alignment
                            </h4>
                            {selectedSession.analysis.taskRelativity.score !== null && (
                              <span className={`px-3 py-1 rounded-full text-sm font-semibold ${selectedSession.analysis.taskRelativity.score >= 70 ? 'bg-green-100 text-green-700' :
                                  selectedSession.analysis.taskRelativity.score >= 50 ? 'bg-yellow-100 text-yellow-700' :
                                    'bg-red-100 text-red-700'
                                }`}>
                                {selectedSession.analysis.taskRelativity.score}%
                              </span>
                            )}
                          </div>

                          {selectedSession.analysis.taskRelativity.assessment && (
                            <p className="text-sm text-gray-600">
                              {selectedSession.analysis.taskRelativity.assessment}
                            </p>
                          )}

                          {selectedSession.analysis.taskRelativity.matchedTasks?.length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-green-700 mb-1">Tasks Being Worked On:</p>
                              <div className="flex flex-wrap gap-1">
                                {selectedSession.analysis.taskRelativity.matchedTasks.map((task, idx) => (
                                  <span key={idx} className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">
                                    ✓ {task}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {selectedSession.analysis.taskRelativity.unrelatedActivities?.length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-amber-700 mb-1">Unrelated Activities:</p>
                              <div className="flex flex-wrap gap-1">
                                {selectedSession.analysis.taskRelativity.unrelatedActivities.map((activity, idx) => (
                                  <span key={idx} className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs">
                                    {activity}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Time Distribution */}
                      {selectedSession.analysis.timeDistribution && (
                        <div>
                          <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                            <HiOutlineClock className="w-4 h-4 text-blue-500" />
                            Time Distribution
                          </h4>
                          <div className="space-y-2">
                            {[
                              { key: 'deepWork', label: 'Deep Work', color: 'bg-green-500' },
                              { key: 'collaboration', label: 'Collaboration', color: 'bg-blue-500' },
                              { key: 'administrative', label: 'Administrative', color: 'bg-primary-500' },
                              { key: 'breaks', label: 'Breaks', color: 'bg-gray-400' },
                              { key: 'unfocused', label: 'Unfocused', color: 'bg-red-400' }
                            ].map(({ key, label, color }) => {
                              const value = selectedSession.analysis.timeDistribution[key] || 0;
                              if (value === 0) return null;
                              return (
                                <div key={key} className="flex items-center gap-2">
                                  <span className="text-xs text-gray-500 w-24">{label}</span>
                                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                                    <div className={`h-full ${color} rounded-full`} style={{ width: `${value}%` }} />
                                  </div>
                                  <span className="text-xs font-medium text-gray-700 w-10 text-right">{value}%</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Focus Metrics */}
                      {selectedSession.analysis.focusMetrics && (
                        <div className="grid grid-cols-3 gap-3">
                          {selectedSession.analysis.focusMetrics.longestFocusStreak && (
                            <div className="bg-blue-50 rounded-lg p-3 text-center">
                              <p className="text-lg font-semibold text-blue-700">{selectedSession.analysis.focusMetrics.longestFocusStreak}</p>
                              <p className="text-xs text-blue-600">Focus Streak</p>
                            </div>
                          )}
                          {selectedSession.analysis.focusMetrics.contextSwitches != null && (
                            <div className="bg-amber-50 rounded-lg p-3 text-center">
                              <p className="text-lg font-semibold text-amber-700">{selectedSession.analysis.focusMetrics.contextSwitches}</p>
                              <p className="text-xs text-amber-600">Context Switches</p>
                            </div>
                          )}
                          {selectedSession.analysis.focusMetrics.distractionCount != null && (
                            <div className="bg-red-50 rounded-lg p-3 text-center">
                              <p className="text-lg font-semibold text-red-700">{selectedSession.analysis.focusMetrics.distractionCount}</p>
                              <p className="text-xs text-red-600">Distractions</p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Work Categories */}
                      {selectedSession.analysis.workCategories?.length > 0 && (
                        <div>
                          <h4 className="font-medium text-gray-900 mb-3">Work Breakdown</h4>
                          <div className="space-y-2">
                            {selectedSession.analysis.workCategories.map((cat, idx) => (
                              <div key={idx} className="flex items-center gap-2">
                                <span className="text-xs text-gray-600 w-28 truncate">{cat.category}</span>
                                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                                  <div className="h-full bg-primary-500 rounded-full" style={{ width: `${cat.percentage}%` }} />
                                </div>
                                <span className="text-xs font-medium text-gray-700 w-10 text-right">{cat.percentage}%</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Achievements */}
                      {selectedSession.analysis.achievements?.length > 0 && (
                        <div>
                          <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                            <HiOutlineTrophy className="w-4 h-4 text-amber-500" />
                            Achievements
                          </h4>
                          <div className="space-y-2">
                            {selectedSession.analysis.achievements.map((achievement, idx) => (
                              <div key={idx} className="flex items-start gap-2 text-sm">
                                <span className="text-green-500 mt-0.5">✓</span>
                                <span className="text-gray-700">{achievement}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Suggestions */}
                      {(selectedSession.analysis.suggestions?.length > 0 || selectedSession.analysis.improvements?.length > 0) && (
                        <div>
                          <h4 className="font-medium text-gray-900 mb-3">Suggestions for Improvement</h4>
                          <div className="space-y-2">
                            {(selectedSession.analysis.suggestions || selectedSession.analysis.improvements || []).map((suggestion, idx) => (
                              <div key={idx} className="flex items-start gap-2 text-sm bg-amber-50 p-2 rounded-lg">
                                <span className="text-amber-500 mt-0.5">💡</span>
                                <span className="text-gray-700">{suggestion}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Concerns */}
                      {selectedSession.analysis.concerns?.length > 0 && (
                        <div>
                          <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2 text-red-600">
                            <HiOutlineExclamationCircle className="w-4 h-4" />
                            Areas of Concern
                          </h4>
                          <div className="space-y-2">
                            {selectedSession.analysis.concerns.map((concern, idx) => (
                              <div key={idx} className="flex items-start gap-2 text-sm bg-red-50 p-2 rounded-lg">
                                <span className="text-red-500 mt-0.5">⚠️</span>
                                <span className="text-gray-700">{concern}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Red Flags */}
                      {selectedSession.analysis.redFlags?.length > 0 && (
                        <div>
                          <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2 text-red-700">
                            <HiOutlineExclamationCircle className="w-4 h-4" />
                            Red Flags Detected
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {selectedSession.analysis.redFlags.map((flag, idx) => (
                              <span
                                key={idx}
                                className="px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700"
                              >
                                🚩 {flag}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Insights */}
                      {selectedSession.analysis.insights?.length > 0 && (
                        <div>
                          <h4 className="font-medium text-gray-900 mb-3">Key Insights</h4>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {selectedSession.analysis.insights.map((insight, idx) => (
                              <div key={idx} className="text-sm bg-gray-50 p-3 rounded-lg text-gray-600">
                                {insight}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Overall Assessment */}
                      {selectedSession.analysis.overallAssessment && (
                        <div className="bg-blue-50 dark:bg-blue-950/30 rounded-xl p-4 space-y-3">
                          <h4 className="font-medium text-blue-900">Overall Assessment</h4>

                          {/* Genuine Work Percentage */}
                          {selectedSession.analysis.overallAssessment.genuineWorkPercentage !== undefined && (
                            <div className="flex items-center gap-3 mb-3">
                              <span className="text-sm text-gray-600">Genuine Work:</span>
                              <div className="flex-1 bg-gray-200 rounded-full h-2">
                                <div
                                  className={`h-2 rounded-full ${selectedSession.analysis.overallAssessment.genuineWorkPercentage >= 70 ? 'bg-green-500' :
                                      selectedSession.analysis.overallAssessment.genuineWorkPercentage >= 50 ? 'bg-yellow-500' :
                                        'bg-red-500'
                                    }`}
                                  style={{ width: `${selectedSession.analysis.overallAssessment.genuineWorkPercentage}%` }}
                                />
                              </div>
                              <span className="text-sm font-semibold">{selectedSession.analysis.overallAssessment.genuineWorkPercentage}%</span>
                            </div>
                          )}

                          {selectedSession.analysis.overallAssessment.strengths?.length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-green-700 mb-1">Strengths</p>
                              <ul className="text-sm text-gray-700 list-disc list-inside">
                                {selectedSession.analysis.overallAssessment.strengths.map((s, idx) => (
                                  <li key={idx}>{s}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Major Concerns */}
                          {selectedSession.analysis.overallAssessment.majorConcerns?.length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-red-700 mb-1">Major Concerns</p>
                              <ul className="text-sm text-red-600 list-disc list-inside">
                                {selectedSession.analysis.overallAssessment.majorConcerns.map((c, idx) => (
                                  <li key={idx}>{c}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {selectedSession.analysis.overallAssessment.areasForImprovement?.length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-amber-700 mb-1">Areas for Improvement</p>
                              <ul className="text-sm text-gray-700 list-disc list-inside">
                                {selectedSession.analysis.overallAssessment.areasForImprovement.map((a, idx) => (
                                  <li key={idx}>{a}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {selectedSession.analysis.overallAssessment.recommendation && (
                            <div className="mt-2 pt-2 border-t border-blue-100">
                              <p className="text-sm text-blue-800 italic">
                                <strong>Recommendation:</strong> {selectedSession.analysis.overallAssessment.recommendation}
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Applications Used */}
                      {(selectedSession.analysis.detectedApplications?.length > 0 || selectedSession.analysis.applications?.length > 0) && (
                        <div>
                          <h4 className="font-medium text-gray-900 mb-3">Applications Used</h4>
                          <div className="flex flex-wrap gap-2">
                            {(selectedSession.analysis.applications || selectedSession.analysis.detectedApplications || []).map((app, idx) => (
                              <span
                                key={idx}
                                className={`px-3 py-1 rounded-full text-xs font-medium ${app.productivityImpact === 'positive' || app.category === 'work' || app.category === 'development' ? 'bg-green-100 text-green-700' :
                                    app.productivityImpact === 'negative' || app.category === 'entertainment' ? 'bg-red-100 text-red-700' :
                                      app.category === 'communication' ? 'bg-blue-100 text-blue-700' :
                                        'bg-gray-100 text-gray-700'
                                  }`}
                              >
                                {app.name} {(app.duration || app.estimatedMinutes) ? `(${app.duration || app.estimatedMinutes}m)` : ''}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Websites Visited */}
                      {selectedSession.analysis.websites?.length > 0 && (
                        <div>
                          <h4 className="font-medium text-gray-900 mb-3">Websites Visited</h4>
                          <div className="flex flex-wrap gap-2">
                            {selectedSession.analysis.websites.map((site, idx) => (
                              <span
                                key={idx}
                                className={`px-3 py-1 rounded-full text-xs font-medium ${site.category === 'work' || site.category === 'research' ? 'bg-blue-100 text-blue-700' :
                                    site.category === 'social' || site.category === 'entertainment' ? 'bg-red-100 text-red-700' :
                                      'bg-gray-100 text-gray-700'
                                  }`}
                              >
                                {site.domain} {site.estimatedMinutes ? `(${site.estimatedMinutes}m)` : ''}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center py-12">
                      <div className="w-20 h-20 bg-primary-100 dark:bg-primary-900/50 rounded-2xl flex items-center justify-center mb-4">
                        <HiOutlineSparkles className="w-10 h-10 text-primary-500" />
                      </div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">AI Analysis Available</h3>
                      <p className="text-sm text-gray-500 mb-6 max-w-xs">
                        Get detailed insights about productivity, work patterns, and suggestions for improvement.
                      </p>
                      <Button
                        onPress={() => analyzeSession(selectedSession._id)}
                        isLoading={analyzing}
                        color="primary"
                        size="lg"
                        startContent={!analyzing && <HiOutlineSparkles className="w-5 h-5" />}
                      >
                        {analyzing ? 'Analyzing...' : 'Analyze with AI'}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  )
}
