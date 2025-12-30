'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '../components/MobileLayout';
import '@/components/MobileApp/styles/mobile.css';

/**
 * Mobile Attendance Page
 * Today's attendance view with check-in/out functionality
 */
export default function MobileAttendance({ 
  user, 
  attendance, 
  location,
  pendingCorrections = 0 
}) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  // Format time for display
  const formatTime = (dateString) => {
    if (!dateString) return '--:--';
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  // Calculate work hours
  const getWorkHours = () => {
    if (!attendance?.checkIn) return '0h 0m';
    const checkIn = new Date(attendance.checkIn);
    const checkOut = attendance?.checkOut ? new Date(attendance.checkOut) : new Date();
    const diff = checkOut - checkIn;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  // Get current date formatted
  const getCurrentDate = () => {
    return new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Handle check in
  const handleCheckIn = async () => {
    setIsLoading(true);
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
    } finally {
      setIsLoading(false);
    }
  };

  // Handle check out
  const handleCheckOut = async () => {
    setIsLoading(true);
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
    } finally {
      setIsLoading(false);
    }
  };

  const isCheckedIn = attendance?.checkIn && !attendance?.checkOut;
  const isCompleted = attendance?.checkIn && attendance?.checkOut;

  return (
    <MobileLayout title="Attendance" user={user}>
      <div className="mobile-page">
        {/* Page Header */}
        <div className="mobile-mb-6">
          <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', color: 'var(--mobile-gray-900)' }}>
            Attendance
          </h2>
          <p style={{ color: 'var(--mobile-gray-400)', fontSize: '14px', fontWeight: 500 }}>
            Track your attendance and work hours
          </p>
        </div>

        {/* Action Buttons */}
        <div className="mobile-grid-2 mobile-mb-8">
          <button 
            className="mobile-color-card mobile-color-card-orange"
            onClick={() => router.push('/dashboard/attendance/corrections')}
            style={{ padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}
          >
            <span className="material-icons-round" style={{ fontSize: '30px' }}>report_problem</span>
            <span style={{ fontSize: '14px', fontWeight: 700 }}>Missing Entry</span>
          </button>
          <button 
            className="mobile-color-card mobile-color-card-blue"
            onClick={() => router.push('/dashboard/attendance/requests')}
            style={{ padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}
          >
            <span className="material-icons-round" style={{ fontSize: '30px' }}>assignment</span>
            <span style={{ fontSize: '14px', fontWeight: 700 }}>Requests ({pendingCorrections})</span>
          </button>
        </div>

        {/* Today's Attendance Card */}
        <div className="mobile-card mobile-card-soft mobile-mb-8" style={{ borderRadius: '32px', padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 700 }}>Today's Attendance</h3>
            <span className="mobile-badge mobile-badge-blue mobile-badge-pill">
              {getCurrentDate()}
            </span>
          </div>

          {/* Stats Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '32px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <span className="material-icons-round" style={{ fontSize: '14px', color: 'var(--mobile-primary)' }}>login</span>
                <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--mobile-gray-400)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  Check In
                </span>
              </div>
              <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--mobile-gray-900)' }}>
                {formatTime(attendance?.checkIn)}
              </span>
            </div>
            
            <div style={{ borderLeft: '1px solid var(--mobile-gray-100)', paddingLeft: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <span className="material-icons-round" style={{ fontSize: '14px', color: 'var(--mobile-primary)' }}>logout</span>
                <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--mobile-gray-400)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  Check Out
                </span>
              </div>
              <span style={{ fontSize: '18px', fontWeight: 700, color: attendance?.checkOut ? 'var(--mobile-gray-900)' : 'var(--mobile-gray-300)' }}>
                {formatTime(attendance?.checkOut)}
              </span>
            </div>
            
            <div style={{ borderLeft: '1px solid var(--mobile-gray-100)', paddingLeft: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <span className="material-icons-round" style={{ fontSize: '14px', color: 'var(--mobile-primary)' }}>schedule</span>
                <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--mobile-gray-400)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  Hours
                </span>
              </div>
              <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--mobile-gray-900)' }}>
                {getWorkHours()}
              </span>
            </div>
          </div>

          {/* Location Card */}
          <div className="mobile-location-card mobile-mb-6">
            <div style={{ marginTop: '2px' }}>
              <span className="material-icons-round" style={{ color: 'var(--mobile-green-500)' }}>place</span>
            </div>
            <div>
              <span className="mobile-location-label">Current Location</span>
              <p className="mobile-location-text">
                {location || 'Location not available'}
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="mobile-grid-2">
            <button 
              onClick={handleCheckIn}
              disabled={isCheckedIn || isCompleted || isLoading}
              className="mobile-btn mobile-btn-secondary mobile-btn-full"
              style={{ 
                padding: '16px',
                opacity: (isCheckedIn || isCompleted) ? 0.5 : 1,
                cursor: (isCheckedIn || isCompleted) ? 'not-allowed' : 'pointer'
              }}
            >
              <span className="material-icons-round">login</span>
              Clock In
            </button>
            <button 
              onClick={handleCheckOut}
              disabled={!isCheckedIn || isLoading}
              className="mobile-btn mobile-btn-secondary mobile-btn-full"
              style={{ 
                padding: '16px',
                opacity: !isCheckedIn ? 0.5 : 1,
                cursor: !isCheckedIn ? 'not-allowed' : 'pointer'
              }}
            >
              <span className="material-icons-round">logout</span>
              Clock Out
            </button>
          </div>
        </div>

        {/* View History Link */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '16px' }}>
          <div>
            <h3 style={{ fontSize: '18px', fontWeight: 700 }}>My Attendance</h3>
            <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--mobile-gray-400)' }}>
              {user?.name || user?.email?.split('@')[0]}
            </p>
          </div>
          <button 
            className="mobile-section-link"
            onClick={() => router.push('/dashboard/attendance/history')}
          >
            View History
          </button>
        </div>

        {/* Placeholder for calendar/list */}
        <div style={{
          background: 'white',
          border: '2px dashed var(--mobile-gray-100)',
          borderRadius: '24px',
          padding: '48px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center'
        }}>
          <p style={{ color: 'var(--mobile-gray-300)', fontSize: '14px', fontStyle: 'italic', fontWeight: 500 }}>
            Click on any day to edit or report missing entry
          </p>
        </div>
      </div>
    </MobileLayout>
  );
}
