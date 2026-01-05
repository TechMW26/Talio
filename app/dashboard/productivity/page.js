'use client'

import { useState, useEffect, useCallback } from 'react'
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
  HiOutlineExclamationCircle
} from 'react-icons/hi2'
import RawCaptureViewer from '@/components/productivity/RawCaptureViewer'
import ManualCapturePanel from '@/components/productivity/ManualCapturePanel'
import ModalPortal from '@/components/ModalPortal'
import { useAILoading } from '@/contexts/AILoadingContext'

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
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('my') // 'my' or 'team'
  const [selectedSession, setSelectedSession] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [canViewTeam, setCanViewTeam] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [viewMode, setViewMode] = useState('sessions') // 'sessions', 'raw', 'manual'
  const [selectedTeamMember, setSelectedTeamMember] = useState(null) // For viewing team member's raw captures
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0) // For screenshot slider in modal
  const [selectedEmployee, setSelectedEmployee] = useState(null) // For viewing team member's sessions
  const [employeeSessions, setEmployeeSessions] = useState([]) // Sessions for selected employee
  const [loadingEmployeeSessions, setLoadingEmployeeSessions] = useState(false)
  
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
  const isDepartmentHead = user?.isDepartmentHead === true

  // Check if user can view team (admin, hr, manager, dept_head, or actual department head)
  useEffect(() => {
    const teamRoles = ['admin', 'hr', 'manager', 'department_head']
    setCanViewTeam(teamRoles.includes(userRole) || isDepartmentHead)
  }, [userRole, isDepartmentHead])

  // Fetch sessions for selected date
  const fetchSessions = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch(`/api/productivity/sessions?date=${selectedDate}`)
      if (res.ok) {
        const data = await res.json()
        setSessions(data.data || data.sessions || [])
      }
    } catch (error) {
      console.error('Error fetching sessions:', error)
    } finally {
      setLoading(false)
    }
  }, [selectedDate])

  // Fetch team sessions
  const fetchTeamSessions = useCallback(async () => {
    if (!canViewTeam) return
    try {
      const res = await fetch(`/api/productivity/team?date=${selectedDate}`)
      if (res.ok) {
        const data = await res.json()
        // Transform API response to frontend format
        const members = (data.data || []).map(m => ({
          ...m,
          name: `${m.firstName || ''} ${m.lastName || ''}`.trim() || m.email,
          sessionCount: m.sessionsSummary?.totalSessions || 0,
          sessions: m.sessionsSummary?.sessions || []
        }))
        setTeamSessions(members)
      }
    } catch (error) {
      console.error('Error fetching team sessions:', error)
    }
  }, [selectedDate, canViewTeam])

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  // Fetch team sessions when user can view team
  useEffect(() => {
    if (canViewTeam) {
      fetchTeamSessions()
    }
  }, [canViewTeam, fetchTeamSessions, selectedDate])

  // Create sessions from screenshots
  const refreshSessions = async () => {
    try {
      setRefreshing(true)
      await fetch('/api/productivity/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedDate })
      })
      await fetchSessions()
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
      const res = await fetch(`/api/productivity/sessions?userId=${userId}&date=${targetDate}`)
      if (res.ok) {
        const data = await res.json()
        setEmployeeSessions(data.data || data.sessions || [])
      } else {
        console.error('Failed to fetch employee sessions:', res.status)
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
      const res = await fetch(`/api/productivity/sessions/${sessionId}`)
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
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4 sm:mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 sm:p-3 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl shadow-lg">
            <HiOutlineComputerDesktop className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Productivity</h1>
            <p className="text-xs sm:text-sm text-gray-500">Monitor your work activity</p>
          </div>
        </div>

        {/* Date Navigation */}
        <div className="flex items-center gap-1 sm:gap-2 bg-white rounded-xl shadow-sm border px-1 sm:px-2 py-1">
          <button 
            onClick={() => changeDate(-1)}
            className="p-1.5 sm:p-2 hover:bg-gray-100 rounded-lg transition"
          >
            <HiOutlineChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
          <div className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3">
            <HiOutlineCalendarDays className="w-4 h-4 sm:w-5 sm:h-5 text-gray-400" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              max={new Date().toISOString().split('T')[0]}
              className="border-0 focus:ring-0 text-xs sm:text-sm font-medium w-[110px] sm:w-auto"
            />
          </div>
          <button 
            onClick={() => changeDate(1)}
            disabled={selectedDate >= new Date().toISOString().split('T')[0]}
            className="p-1.5 sm:p-2 hover:bg-gray-100 rounded-lg transition disabled:opacity-50"
          >
            <HiOutlineChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </div>
      </div>

      {/* Tabs (if can view team) */}
      {canViewTeam && (
        <div className="flex gap-2 mb-4 sm:mb-6">
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
            className={`flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm sm:text-base font-medium transition flex-1 sm:flex-initial ${
              activeTab === 'my' 
                ? 'bg-purple-600 text-white' 
                : 'bg-white text-gray-600 hover:bg-gray-50 border'
            }`}
          >
            <HiOutlineUser className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="hidden sm:inline">My Activity</span>
            <span className="sm:hidden">My</span>
          </button>
          <button
            onClick={() => {
              setActiveTab('team')
              // Reset selected employee when switching to team tab
              setSelectedEmployee(null)
              setEmployeeSessions([])
            }}
            className={`flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm sm:text-base font-medium transition flex-1 sm:flex-initial ${
              activeTab === 'team' 
                ? 'bg-purple-600 text-white' 
                : 'bg-white text-gray-600 hover:bg-gray-50 border'
            }`}
          >
            <HiOutlineUsers className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="hidden sm:inline">Team Activity</span>
            <span className="sm:hidden">Team</span>
          </button>
        </div>
      )}

      {/* View Mode Tabs */}
      <div className="flex flex-wrap gap-2 mb-4 sm:mb-6 bg-gray-100 p-1 rounded-xl">
        <button
          onClick={() => setViewMode('sessions')}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition flex-1 sm:flex-initial ${
            viewMode === 'sessions'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <HiOutlineSquares2X2 className="w-4 h-4" />
          <span className="hidden sm:inline">Sessions</span>
        </button>
        <button
          onClick={() => setViewMode('raw')}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition flex-1 sm:flex-initial ${
            viewMode === 'raw'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <HiOutlinePhoto className="w-4 h-4" />
          <span className="hidden sm:inline">Raw Captures</span>
          <span className="sm:hidden">Raw</span>
        </button>
        {canViewTeam && activeTab === 'team' && (
          <button
            onClick={() => setViewMode('manual')}
            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition flex-1 sm:flex-initial ${
              viewMode === 'manual'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <HiOutlineCamera className="w-4 h-4" />
            <span className="hidden sm:inline">Manual Capture</span>
            <span className="sm:hidden">Manual</span>
          </button>
        )}
      </div>

      {/* Raw Capture View */}
      {viewMode === 'raw' && (
        <>
          {/* Team member selector for team tab */}
          {activeTab === 'team' && canViewTeam && (
            <div className="mb-4 flex items-center gap-3">
              <label className="text-sm font-medium text-gray-700">View captures for:</label>
              <select
                value={selectedTeamMember || ''}
                onChange={(e) => setSelectedTeamMember(e.target.value || null)}
                className="border rounded-lg px-3 py-2 text-sm focus:ring-purple-500 focus:border-purple-500 min-w-[200px]"
              >
                <option value="">Select team member</option>
                {teamSessions.map((member) => (
                  <option key={member.userId || member._id} value={member.userId || member._id}>
                    {member.name || `${member.firstName || ''} ${member.lastName || ''}`.trim() || member.email}
                  </option>
                ))}
              </select>
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
            <div className="bg-white rounded-2xl shadow-sm border p-6 sm:p-12 text-center">
              <HiOutlineUsers className="w-12 h-12 sm:w-16 sm:h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-base sm:text-lg font-medium text-gray-900 mb-2">Select a team member</h3>
              <p className="text-sm sm:text-base text-gray-500">
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
          <div className="flex justify-end mb-4">
            <button
              onClick={refreshSessions}
              disabled={refreshing}
              className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 bg-white border rounded-lg hover:bg-gray-50 transition text-xs sm:text-sm font-medium"
            >
              <HiOutlineArrowPath className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${refreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{refreshing ? 'Refreshing...' : 'Refresh Sessions'}</span>
              <span className="sm:hidden">{refreshing ? 'Refreshing...' : 'Refresh'}</span>
            </button>
          </div>

          {/* Sessions Grid */}
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
            </div>
          ) : sessions.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm border p-6 sm:p-12 text-center">
              <HiOutlinePhoto className="w-12 h-12 sm:w-16 sm:h-16 text-gray-300 mx-auto mb-3 sm:mb-4" />
              <h3 className="text-base sm:text-lg font-medium text-gray-900 mb-2">No activity recorded</h3>
              <p className="text-sm sm:text-base text-gray-500 mb-4">
                No screenshots were captured on this date. Make sure the desktop app is running while clocked in.
              </p>
              <button
                onClick={refreshSessions}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition text-sm sm:text-base"
              >
                Check for Screenshots
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {sessions.map((session, index) => (
                <div
                  key={session._id}
                  className="bg-white rounded-xl shadow-sm border overflow-hidden hover:shadow-md transition cursor-pointer"
                  onClick={() => {
                    setSelectedSession(session)
                    setCurrentSlideIndex(0)
                  }}
                >
                  {/* Session Preview - Show analysis complete state or screenshot */}
                  <div className="aspect-video bg-gray-100 relative">
                    {session.analysis?.isAnalyzed || session.screenshotsDeleted ? (
                      // Show "Analysis Complete" preview for analyzed sessions
                      <div className="flex flex-col items-center justify-center h-full bg-gradient-to-br from-purple-500 to-indigo-600 text-white">
                        <HiOutlineSparkles className="w-10 h-10 mb-2" />
                        <span className="text-sm font-medium">Analysis Complete</span>
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
                  </div>

                  {/* Session Info */}
                  <div className="p-3 sm:p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm sm:text-base font-medium text-gray-900">
                        {session.sessionTitle || `Session ${index + 1}`}
                      </h3>
                      {session.analysis?.score != null && !session.analysis?.isAnalyzed && (
                        <span className={`px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-xs font-medium ${getScoreColor(session.analysis.score)}`}>
                          {session.analysis.score}%
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 sm:gap-4 text-xs sm:text-sm text-gray-500 mb-2">
                      <span className="flex items-center gap-1">
                        <HiOutlineClock className="w-3 h-3 sm:w-4 sm:h-4" />
                        <span className="truncate">{formatTime(session.startTime)} - {formatTime(session.endTime)}</span>
                      </span>
                    </div>
                    
                    {/* Show analysis results if analyzed */}
                    {session.analysis?.isAnalyzed ? (
                      <div className="space-y-2">
                        {/* Summary Preview */}
                        {session.analysis.summary && (
                          <p className="text-xs sm:text-sm text-gray-600 line-clamp-2">
                            {session.analysis.summary}
                          </p>
                        )}
                        
                        {/* Quick stats */}
                        <div className="flex flex-wrap gap-1.5">
                          {session.analysis.achievements?.length > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-50 text-green-700 rounded text-[10px] sm:text-xs">
                              <HiOutlineTrophy className="w-3 h-3" />
                              {session.analysis.achievements.length} wins
                            </span>
                          )}
                          {(session.analysis.suggestions?.length > 0 || session.analysis.improvements?.length > 0) && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 rounded text-[10px] sm:text-xs">
                              💡 {(session.analysis.suggestions?.length || 0) + (session.analysis.improvements?.length || 0)} tips
                            </span>
                          )}
                          {session.analysis.insights?.length > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] sm:text-xs">
                              📊 {session.analysis.insights.length} insights
                            </span>
                          )}
                        </div>
                        
                        {/* View details hint */}
                        <p className="text-[10px] sm:text-xs text-purple-600 font-medium mt-2">
                          Click to view full analysis →
                        </p>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          analyzeSession(session._id)
                        }}
                        disabled={analyzing}
                        className="mt-2 w-full flex items-center justify-center gap-1.5 sm:gap-2 px-3 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg text-xs sm:text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
                      >
                        <HiOutlineSparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        <span className="hidden sm:inline">{analyzing ? 'Analyzing...' : 'Analyze with AI'}</span>
                        <span className="sm:hidden">{analyzing ? 'Analyzing...' : 'Analyze'}</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
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
              <div className="mb-4 flex items-center gap-4">
                <button
                  onClick={handleBackToTeam}
                  className="flex items-center gap-2 px-3 py-2 bg-white border rounded-lg hover:bg-gray-50 transition text-sm font-medium"
                >
                  <HiOutlineChevronLeft className="w-4 h-4" />
                  <span className="hidden sm:inline">Back to Team</span>
                  <span className="sm:hidden">Back</span>
                </button>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-full flex items-center justify-center text-white font-semibold shadow-lg">
                    {selectedEmployee.name?.charAt(0) || selectedEmployee.firstName?.charAt(0) || 'U'}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{selectedEmployee.name || `${selectedEmployee.firstName} ${selectedEmployee.lastName}`}</h3>
                    <p className="text-xs text-gray-500">{selectedEmployee.designation || selectedEmployee.department || 'Team Member'}</p>
                  </div>
                </div>
              </div>

              {/* Employee Sessions Grid */}
              {loadingEmployeeSessions ? (
                <div className="flex items-center justify-center h-64">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
                </div>
              ) : employeeSessions.length === 0 ? (
                <div className="bg-white rounded-2xl shadow-sm border p-6 sm:p-12 text-center">
                  <HiOutlinePhoto className="w-12 h-12 sm:w-16 sm:h-16 text-gray-300 mx-auto mb-3 sm:mb-4" />
                  <h3 className="text-base sm:text-lg font-medium text-gray-900 mb-2">No activity recorded</h3>
                  <p className="text-sm sm:text-base text-gray-500">
                    {selectedEmployee.name || 'This employee'} has no screenshots on this date.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                  {employeeSessions.map((session, index) => (
                    <div
                      key={session._id}
                      onClick={() => {
                        setSelectedSession(session)
                        setCurrentSlideIndex(0)
                      }}
                      className="bg-white rounded-xl shadow-sm border overflow-hidden hover:shadow-md transition-all duration-200 cursor-pointer group"
                    >
                      {/* Session Header */}
                      <div className="p-3 sm:p-4 border-b">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 sm:gap-3">
                            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-lg flex items-center justify-center text-white text-sm sm:text-base font-bold">
                              {index + 1}
                            </div>
                            <div>
                              <h3 className="font-semibold text-gray-900 text-sm sm:text-base">
                                {session.sessionTitle || `Session ${index + 1}`}
                              </h3>
                              <p className="text-[10px] sm:text-xs text-gray-500">
                                {formatTime(session.startTime)} - {formatTime(session.endTime)}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] sm:text-xs text-gray-400">{session.screenshotCount || session.screenshots?.length || 0} screenshots</span>
                          </div>
                        </div>
                      </div>

                      {/* Preview Screenshots */}
                      <div className="p-2 sm:p-3">
                        {session.screenshotsDeleted || session.analysis?.isAnalyzed ? (
                          <div className="aspect-video bg-gradient-to-br from-purple-50 to-indigo-50 rounded-lg flex items-center justify-center">
                            <div className="text-center">
                              <HiOutlineSparkles className="w-8 h-8 text-purple-400 mx-auto mb-2" />
                              <p className="text-xs text-purple-600 font-medium">Analysis Complete</p>
                            </div>
                          </div>
                        ) : session.screenshots?.length > 0 ? (
                          <div className="grid grid-cols-3 gap-1 sm:gap-1.5">
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
                      <div className="p-3 sm:p-4 border-t bg-gray-50">
                        {session.analysis?.isAnalyzed ? (
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <span className={`px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-xs font-medium ${getScoreColor(session.analysis.score)}`}>
                                {session.analysis.score}%
                              </span>
                              <span className="text-[10px] sm:text-xs text-gray-500">productivity score</span>
                            </div>
                            <p className="text-[10px] sm:text-xs text-purple-600 font-medium">
                              Click to view full analysis →
                            </p>
                          </div>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              analyzeSession(session._id)
                            }}
                            disabled={analyzing}
                            className="mt-2 w-full flex items-center justify-center gap-1.5 sm:gap-2 px-3 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg text-xs sm:text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
                          >
                            <HiOutlineSparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                            <span>{analyzing ? 'Analyzing...' : 'Analyze with AI'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            /* Team Grid View */
            <>
          {teamSessions.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm border p-6 sm:p-12 text-center">
              <HiOutlineUsers className="w-12 h-12 sm:w-16 sm:h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-base sm:text-lg font-medium text-gray-900 mb-2">No team activity</h3>
              <p className="text-sm sm:text-base text-gray-500">
                No team members have recorded activity on this date.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {teamSessions.map((member) => {
                // Get sessions from sessionsSummary
                const memberSessions = member.sessionsSummary?.sessions || [];
                const firstSession = memberSessions[0];
                const previewUrl = firstSession?.previewUrl || getScreenshotUrl(firstSession?.screenshots?.[0]);
                
                return (
                <div 
                  key={member.userId} 
                  className="bg-white rounded-xl shadow-sm border overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => handleSelectEmployee(member)}
                >
                  {/* Card Header with Profile */}
                  <div className="p-4 border-b bg-gradient-to-r from-purple-50 to-indigo-50">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-full flex items-center justify-center text-white text-lg font-semibold shadow-lg">
                        {member.name?.charAt(0) || member.firstName?.charAt(0) || 'U'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-gray-900 truncate">{member.name || `${member.firstName} ${member.lastName}`}</h3>
                        <p className="text-xs text-gray-500">{member.designation || member.department || 'Team Member'}</p>
                      </div>
                    </div>
                  </div>
                  
                  {/* Stats */}
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <HiOutlineSquares2X2 className="w-4 h-4 text-purple-500" />
                        <span className="text-sm font-medium text-gray-700">{member.sessionsSummary?.totalSessions || 0} Sessions</span>
                      </div>
                      {member.sessionsSummary?.averageScore && (
                        <div className="flex items-center gap-1">
                          <HiOutlineTrophy className="w-4 h-4 text-amber-500" />
                          <span className={`text-sm font-bold ${
                            member.sessionsSummary.averageScore >= 70 ? 'text-green-600' :
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
                          <span className="text-white text-sm font-medium">View Sessions</span>
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
                          <p className="text-xs text-gray-400">No screenshots</p>
                        </div>
                      </div>
                    )}
                    
                    {/* Quick Stats Bar */}
                    <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                      <span>{member.sessionsSummary?.totalScreenshots || 0} screenshots</span>
                      <span>{member.sessionsSummary?.analyzedSessions || 0} analyzed</span>
                    </div>
                  </div>
                </div>
              )})}
            </div>
          )}
            </>
          )}
        </div>
      )}

      {/* Session Detail Modal */}
      <ModalPortal show={!!selectedSession}>
        {selectedSession && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-2 sm:p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-7xl w-full max-h-[95vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-3 sm:p-4 border-b bg-gray-50">
              <div className="min-w-0 flex-1">
                <h2 className="text-base sm:text-lg font-bold text-gray-900">
                  {selectedSession.sessionTitle || `Session ${selectedSession.sessionNumber || 1}`}
                </h2>
                <p className="text-xs sm:text-sm text-gray-500">
                  {formatTime(selectedSession.startTime)} - {formatTime(selectedSession.endTime)} 
                  {selectedSession.analysis?.isAnalyzed ? (
                    <span> • <span className="text-purple-600 font-medium">AI Analyzed</span></span>
                  ) : (
                    <span> • {selectedSession.screenshots?.length || 0} screenshots</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* Only show analyze button if NOT already analyzed */}
                {!selectedSession.analysis?.isAnalyzed && !selectedSession.screenshotsDeleted && (
                  <button
                    onClick={() => analyzeSession(selectedSession._id)}
                    disabled={analyzing}
                    className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg text-xs sm:text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
                  >
                    <HiOutlineSparkles className="w-4 h-4" />
                    <span className="hidden sm:inline">{analyzing ? 'Analyzing...' : 'Analyze with AI'}</span>
                    <span className="sm:hidden">{analyzing ? '...' : 'Analyze'}</span>
                  </button>
                )}
                <button
                  onClick={() => {
                    setSelectedSession(null)
                    setCurrentSlideIndex(0)
                  }}
                  className="p-2 hover:bg-gray-200 rounded-lg transition"
                >
                  <HiOutlineXMark className="w-5 h-5" />
                </button>
              </div>
            </div>

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
                        <HiOutlineSparkles className="w-10 h-10 text-purple-400" />
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
                            className="absolute left-2 top-1/2 -translate-y-1/2 p-2 bg-white/20 hover:bg-white/40 rounded-full transition backdrop-blur-sm"
                          >
                            <HiOutlineChevronLeft className="w-5 h-5 text-white" />
                          </button>
                          <button
                            onClick={() => setCurrentSlideIndex(prev => prev < selectedSession.screenshots.length - 1 ? prev + 1 : 0)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-white/20 hover:bg-white/40 rounded-full transition backdrop-blur-sm"
                          >
                            <HiOutlineChevronRight className="w-5 h-5 text-white" />
                          </button>
                        </>
                      )}
                      
                      {/* Slide Counter */}
                      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs px-3 py-1.5 rounded-full backdrop-blur-sm">
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
                          className={`flex-shrink-0 w-14 h-10 rounded overflow-hidden border-2 transition ${
                            idx === currentSlideIndex ? 'border-purple-500' : 'border-transparent hover:border-gray-500'
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
                      <div className={`p-3 rounded-xl text-center ${
                        selectedSession.analysis.score >= 70 ? 'bg-green-50 border border-green-200' :
                        selectedSession.analysis.score >= 40 ? 'bg-amber-50 border border-amber-200' : 'bg-red-50 border border-red-200'
                      }`}>
                        <span className={`text-2xl font-bold ${
                          selectedSession.analysis.score >= 70 ? 'text-green-600' :
                          selectedSession.analysis.score >= 40 ? 'text-amber-600' : 'text-red-600'
                        }`}>
                          {selectedSession.analysis.score || '--'}
                        </span>
                        <p className="text-xs text-gray-500 mt-1">Productivity</p>
                      </div>
                      
                      {/* Focus Score */}
                      {selectedSession.analysis.focusScore != null && (
                        <div className={`p-3 rounded-xl text-center ${
                          selectedSession.analysis.focusScore >= 70 ? 'bg-blue-50 border border-blue-200' :
                          selectedSession.analysis.focusScore >= 40 ? 'bg-amber-50 border border-amber-200' : 'bg-red-50 border border-red-200'
                        }`}>
                          <span className={`text-2xl font-bold ${
                            selectedSession.analysis.focusScore >= 70 ? 'text-blue-600' :
                            selectedSession.analysis.focusScore >= 40 ? 'text-amber-600' : 'text-red-600'
                          }`}>
                            {selectedSession.analysis.focusScore}
                          </span>
                          <p className="text-xs text-gray-500 mt-1">Focus</p>
                        </div>
                      )}
                      
                      {/* Task Completion */}
                      {selectedSession.analysis.taskCompletionIndicators != null && (
                        <div className={`p-3 rounded-xl text-center ${
                          selectedSession.analysis.taskCompletionIndicators >= 70 ? 'bg-purple-50 border border-purple-200' :
                          selectedSession.analysis.taskCompletionIndicators >= 40 ? 'bg-amber-50 border border-amber-200' : 'bg-red-50 border border-red-200'
                        }`}>
                          <span className={`text-2xl font-bold ${
                            selectedSession.analysis.taskCompletionIndicators >= 70 ? 'text-purple-600' :
                            selectedSession.analysis.taskCompletionIndicators >= 40 ? 'text-amber-600' : 'text-red-600'
                          }`}>
                            {selectedSession.analysis.taskCompletionIndicators}
                          </span>
                          <p className="text-xs text-gray-500 mt-1">Task Progress</p>
                        </div>
                      )}
                    </div>
                    
                    {/* Summary */}
                    <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl p-4">
                      <h4 className="font-medium text-purple-900 mb-2 flex items-center gap-2">
                        <HiOutlineSparkles className="w-4 h-4" />
                        AI Summary
                      </h4>
                      <p className="text-sm text-gray-700 leading-relaxed">
                        {selectedSession.analysis.summary || 'No summary available'}
                      </p>
                    </div>
                    
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
                            { key: 'administrative', label: 'Administrative', color: 'bg-purple-500' },
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
                                <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${cat.percentage}%` }} />
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
                      <div className="bg-gradient-to-r from-blue-50 to-cyan-50 rounded-xl p-4 space-y-3">
                        <h4 className="font-medium text-blue-900">Overall Assessment</h4>
                        
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
                              className={`px-3 py-1 rounded-full text-xs font-medium ${
                                app.productivityImpact === 'positive' || app.category === 'work' || app.category === 'development' ? 'bg-green-100 text-green-700' :
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
                              className={`px-3 py-1 rounded-full text-xs font-medium ${
                                site.category === 'work' || site.category === 'research' ? 'bg-blue-100 text-blue-700' :
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
                    <div className="w-20 h-20 bg-gradient-to-br from-purple-100 to-indigo-100 rounded-2xl flex items-center justify-center mb-4">
                      <HiOutlineSparkles className="w-10 h-10 text-purple-500" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">AI Analysis Available</h3>
                    <p className="text-sm text-gray-500 mb-6 max-w-xs">
                      Get detailed insights about productivity, work patterns, and suggestions for improvement.
                    </p>
                    <button
                      onClick={() => analyzeSession(selectedSession._id)}
                      disabled={analyzing}
                      className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-xl font-medium hover:opacity-90 transition disabled:opacity-50 shadow-lg shadow-purple-500/25"
                    >
                      <HiOutlineSparkles className="w-5 h-5" />
                      {analyzing ? 'Analyzing...' : 'Analyze with AI'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        )}
      </ModalPortal>
    </div>
  )
}
