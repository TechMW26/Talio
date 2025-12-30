'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '../components/MobileLayout';
import '@/components/MobileApp/styles/mobile.css';
import { getEmployeeId } from '@/utils/userHelper';
import { formatDesignation } from '@/lib/formatters';

/**
 * Mobile Home Page
 * Dashboard view optimized for mobile devices
 */
export default function MobileHome({ user, employee, attendance: attendanceProp, recentActivity }) {
  const router = useRouter();
  const [workTimer, setWorkTimer] = useState('00:00:00');
  const [isCheckedIn, setIsCheckedIn] = useState(false);
  const [attendance, setAttendance] = useState(attendanceProp || null);
  const [employeeData, setEmployeeData] = useState(employee || null);
  const [loading, setLoading] = useState(!attendanceProp);

  // Fetch attendance data if not provided
  useEffect(() => {
    const fetchData = async () => {
      if (attendanceProp) {
        setAttendance(attendanceProp);
        setLoading(false);
        return;
      }

      try {
        const token = localStorage.getItem('token');
        const employeeId = getEmployeeId(user);

        if (!employeeId) {
          setLoading(false);
          return;
        }

        const today = new Date().toISOString().split('T')[0];
        const response = await fetch(`/api/attendance?employeeId=${employeeId}&date=${today}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();
        if (data.success && data.data.length > 0) {
          setAttendance(data.data[0]);
        }
      } catch (error) {
        console.error('[MobileHome] Failed to fetch attendance:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user, attendanceProp]);

  // Fetch employee data if not provided
  useEffect(() => {
    const fetchEmployee = async () => {
      if (employee) {
        setEmployeeData(employee);
        return;
      }

      try {
        const token = localStorage.getItem('token');
        const employeeId = getEmployeeId(user);

        if (!employeeId) return;

        const response = await fetch(`/api/employees/${employeeId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();
        if (data.success) {
          setEmployeeData(data.data);
        }
      } catch (error) {
        console.error('[MobileHome] Failed to fetch employee:', error);
      }
    };

    fetchEmployee();
  }, [user, employee]);

  // Calculate work timer from check-in time
  useEffect(() => {
    if (attendance?.checkIn && !attendance?.checkOut) {
      setIsCheckedIn(true);
      const checkInTime = new Date(attendance.checkIn);

      const updateTimer = () => {
        const now = new Date();
        const diff = now - checkInTime;
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        setWorkTimer(
          `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
        );
      };

      updateTimer();
      const interval = setInterval(updateTimer, 1000);
      return () => clearInterval(interval);
    } else {
      setIsCheckedIn(false);
      setWorkTimer('00:00:00');
    }
  }, [attendance]);

  // Format time for display
  const formatTime = (dateString) => {
    if (!dateString) return '--:--';
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  // Get user initials
  const getUserInitials = () => {
    if (!employeeData?.firstName) return user?.email?.substring(0, 2).toUpperCase() || 'U';
    return `${employeeData.firstName[0]}${employeeData.lastName?.[0] || ''}`.toUpperCase();
  };

  // Get full name
  const getFullName = () => {
    if (employeeData?.firstName) {
      return `${employeeData.firstName} ${employeeData.lastName || ''}`.trim();
    }
    return user?.email?.split('@')[0] || 'User';
  };

  // Handle check in/out
  const handleCheckIn = async () => {
    try {
      const res = await fetch('/api/attendance/check-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        window.location.reload();
      }
    } catch (error) {
      console.error('Check-in error:', error);
    }
  };

  const handleCheckOut = async () => {
    try {
      const res = await fetch('/api/attendance/check-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        window.location.reload();
      }
    } catch (error) {
      console.error('Check-out error:', error);
    }
  };

  // Get attendance status
  const getAttendanceStatus = () => {
    if (!attendance) return 'Not Checked In';
    if (attendance.checkIn && !attendance.checkOut) return 'Working';
    if (attendance.checkIn && attendance.checkOut) return 'Completed';
    return 'Not Checked In';
  };

  // Calculate break time
  const getBreakTime = () => {
    if (!attendance?.breaks?.length) return '0h 0m';
    const totalBreakMs = attendance.breaks.reduce((acc, b) => {
      if (b.start && b.end) {
        return acc + (new Date(b.end) - new Date(b.start));
      }
      return acc;
    }, 0);
    const hours = Math.floor(totalBreakMs / (1000 * 60 * 60));
    const minutes = Math.floor((totalBreakMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  return (
    <MobileLayout title="Home" user={user}>
      <div className="mobile-page">
        {/* Profile Card */}
        <div className="mobile-gradient-card mobile-mb-8">
          <div style={{ position: 'relative', zIndex: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
              <div style={{ position: 'relative' }}>
                <div style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.2)',
                  border: '2px solid rgba(255,255,255,0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden'
                }}>
                  {user?.avatar ? (
                    <img src={user.avatar} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <span className="material-icons-round" style={{ fontSize: '40px' }}>person</span>
                  )}
                </div>
                <div style={{
                  position: 'absolute',
                  bottom: 0,
                  right: 0,
                  width: '16px',
                  height: '16px',
                  background: isCheckedIn ? '#10B981' : '#6B7280',
                  borderRadius: '50%',
                  border: '2px solid #3B82F6'
                }} />
              </div>
              <div>
                <div style={{
                  background: 'rgba(255,255,255,0.2)',
                  padding: '4px 12px',
                  borderRadius: '9999px',
                  fontSize: '10px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  marginBottom: '4px'
                }}>
                  <span className="material-icons-round" style={{ fontSize: '12px', color: isCheckedIn ? '#34D399' : '#9CA3AF' }}>
                    {isCheckedIn ? 'check_circle' : 'remove_circle'}
                  </span>
                  {getAttendanceStatus()}
                </div>
                <h2 style={{ fontSize: '20px', fontWeight: 700 }}>{getFullName()}</h2>
                <p style={{ color: 'rgba(191, 219, 254, 1)', fontSize: '12px', fontWeight: 500 }}>
                  {employeeData?.employeeId || ''} • {formatDesignation(employeeData?.designation, employeeData) || user?.role || 'Employee'}
                </p>
              </div>
            </div>

            <div className="mobile-grid-2">
              <button
                onClick={handleCheckIn}
                disabled={isCheckedIn}
                className="mobile-btn mobile-btn-ghost mobile-btn-full"
                style={{ opacity: isCheckedIn ? 0.5 : 1, cursor: isCheckedIn ? 'not-allowed' : 'pointer' }}
              >
                <span className="material-icons-round" style={{ fontSize: '18px' }}>login</span>
                Check In
              </button>
              <button
                onClick={handleCheckOut}
                disabled={!isCheckedIn}
                className="mobile-btn mobile-btn-full"
                style={{
                  background: 'white',
                  color: '#3B82F6',
                  opacity: !isCheckedIn ? 0.5 : 1,
                  cursor: !isCheckedIn ? 'not-allowed' : 'pointer'
                }}
              >
                <span className="material-icons-round" style={{ fontSize: '18px' }}>logout</span>
                Check Out
              </button>
            </div>
          </div>
        </div>

        {/* Quick Glance */}
        <div className="mobile-mb-8">
          <div className="mobile-section-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="material-icons-round" style={{ color: 'var(--mobile-primary)', fontSize: '20px' }}>schedule</span>
              <h3 className="mobile-section-title">Quick Glance</h3>
            </div>
            <span style={{
              background: 'var(--mobile-green-100)',
              color: 'var(--mobile-green-700)',
              padding: '6px 12px',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: 700,
              fontFamily: 'monospace'
            }}>
              {workTimer}
            </span>
          </div>

          <div className="mobile-grid-2">
            <div className="mobile-stat-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <div className="mobile-stat-icon" style={{ background: 'var(--mobile-green-50)', color: 'var(--mobile-green-500)' }}>
                  <span className="material-icons-round" style={{ fontSize: '18px' }}>login</span>
                </div>
                <span className="mobile-stat-label">Check In</span>
              </div>
              <p className="mobile-stat-value">{formatTime(attendance?.checkIn)}</p>
              {attendance?.checkIn && (
                <p style={{ fontSize: '10px', fontWeight: 700, color: 'var(--mobile-gray-400)', marginTop: '2px' }}>
                  {attendance?.isLate ? 'Late' : 'On Time'}
                </p>
              )}
            </div>

            <div className="mobile-stat-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <div className="mobile-stat-icon" style={{ background: 'var(--mobile-red-50)', color: 'var(--mobile-red-500)' }}>
                  <span className="material-icons-round" style={{ fontSize: '18px' }}>logout</span>
                </div>
                <span className="mobile-stat-label">Check Out</span>
              </div>
              <p className="mobile-stat-value" style={{ color: attendance?.checkOut ? 'var(--mobile-gray-900)' : 'var(--mobile-gray-300)' }}>
                {formatTime(attendance?.checkOut)}
              </p>
              <p style={{ fontSize: '10px', fontWeight: 700, color: 'var(--mobile-gray-400)', marginTop: '2px' }}>
                {attendance?.checkOut ? 'Completed' : 'Pending'}
              </p>
            </div>

            <div className="mobile-stat-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <div className="mobile-stat-icon" style={{ background: 'var(--mobile-primary-50)', color: 'var(--mobile-primary)' }}>
                  <span className="material-icons-round" style={{ fontSize: '18px' }}>hourglass_empty</span>
                </div>
                <span className="mobile-stat-label">Break Time</span>
              </div>
              <p className="mobile-stat-value">{getBreakTime()}</p>
            </div>

            <div className="mobile-stat-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <div className="mobile-stat-icon" style={{ background: 'var(--mobile-purple-50)', color: 'var(--mobile-purple-500)' }}>
                  <span className="material-icons-round" style={{ fontSize: '18px' }}>verified</span>
                </div>
                <span className="mobile-stat-label">Status</span>
              </div>
              <p className="mobile-stat-value" style={{ color: 'var(--mobile-green-500)' }}>
                {attendance?.status === 'present' ? 'Present' :
                  attendance?.status === 'half-day' ? 'Half Day' :
                    attendance?.status === 'absent' ? 'Absent' : 'In Progress'}
              </p>
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div>
          <div className="mobile-section-header">
            <h3 className="mobile-section-title">Recent Activity</h3>
            <button
              className="mobile-section-link"
              onClick={() => router.push('/dashboard/attendance')}
            >
              View All
            </button>
          </div>

          {recentActivity && recentActivity.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {recentActivity.slice(0, 3).map((activity, idx) => (
                <div key={idx} className="mobile-activity-item">
                  <div className="mobile-activity-left">
                    <div className="mobile-activity-icon">
                      <span className="material-icons-round">
                        {activity.type === 'attendance' ? 'event_available' :
                          activity.type === 'leave' ? 'beach_access' :
                            activity.type === 'task' ? 'task_alt' : 'notifications'}
                      </span>
                    </div>
                    <div>
                      <h4 className="mobile-activity-title">{activity.title}</h4>
                      <p className="mobile-activity-time">{activity.time}</p>
                    </div>
                  </div>
                  <span className={`mobile-badge mobile-badge-pill ${activity.status === 'approved' ? 'mobile-badge-green' :
                    activity.status === 'pending' ? 'mobile-badge-yellow' :
                      activity.status === 'rejected' ? 'mobile-badge-red' : 'mobile-badge-blue'
                    }`}>
                    {activity.status}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mobile-activity-item">
              <div className="mobile-activity-left">
                <div className="mobile-activity-icon">
                  <span className="material-icons-round">event_available</span>
                </div>
                <div>
                  <h4 className="mobile-activity-title">No recent activity</h4>
                  <p className="mobile-activity-time">Check back later</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </MobileLayout>
  );
}
