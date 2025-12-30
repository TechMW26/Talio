'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '../components/MobileLayout';
import '@/components/MobileApp/styles/mobile.css';

/**
 * Mobile Leave Page
 * Leave management view optimized for mobile
 */
export default function MobileLeave({ 
  user, 
  leaveBalance = {},
  recentRequests = [],
  leaveTypes = []
}) {
  const router = useRouter();

  // Calculate balances
  const casualLeave = leaveBalance.casual || { total: 0, used: 0, remaining: 0 };
  const sickLeave = leaveBalance.sick || { total: 0, used: 0, remaining: 0 };
  const totalUsed = (casualLeave.used || 0) + (sickLeave.used || 0);

  // Format date range
  const formatDateRange = (startDate, endDate) => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (start.toDateString() === end.toDateString()) {
      return start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    
    return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  };

  // Get status color
  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'approved': return 'green';
      case 'pending': return 'yellow';
      case 'rejected': return 'red';
      case 'cancelled': return 'gray';
      default: return 'blue';
    }
  };

  return (
    <MobileLayout title="Leave" user={user}>
      <div className="mobile-page">
        {/* Page Header */}
        <div className="mobile-mb-6">
          <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', color: 'var(--mobile-gray-900)' }}>
            Leave Management
          </h2>
          <p style={{ color: 'var(--mobile-gray-400)', fontSize: '14px', fontWeight: 500 }}>
            Apply and manage your leave requests
          </p>
        </div>

        {/* Action Buttons */}
        <div className="mobile-grid-2 mobile-mb-8">
          <button 
            className="mobile-color-card mobile-color-card-blue"
            onClick={() => router.push('/dashboard/leave/apply')}
            style={{ 
              padding: '24px',
              height: '128px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              position: 'relative',
              overflow: 'hidden'
            }}
          >
            <div style={{
              position: 'absolute',
              top: '-16px',
              right: '-16px',
              width: '96px',
              height: '96px',
              background: 'rgba(255,255,255,0.1)',
              borderRadius: '50%',
              filter: 'blur(20px)'
            }} />
            <div style={{
              background: 'rgba(255,255,255,0.2)',
              padding: '8px',
              borderRadius: '12px',
              backdropFilter: 'blur(8px)'
            }}>
              <span className="material-icons-round" style={{ fontSize: '24px' }}>add</span>
            </div>
            <span style={{ fontWeight: 700, fontSize: '16px' }}>Apply Leave</span>
          </button>
          
          <button 
            className="mobile-card mobile-card-soft"
            onClick={() => router.push('/dashboard/leave/requests')}
            style={{ 
              padding: '24px',
              height: '128px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              borderRadius: '24px',
              cursor: 'pointer',
              transition: 'transform 0.2s'
            }}
          >
            <div style={{
              background: 'var(--mobile-primary-50)',
              padding: '8px',
              borderRadius: '12px',
              color: 'var(--mobile-primary)'
            }}>
              <span className="material-icons-outlined" style={{ fontSize: '24px' }}>calendar_month</span>
            </div>
            <span style={{ fontWeight: 700, fontSize: '16px', color: 'var(--mobile-gray-900)' }}>My Requests</span>
          </button>
        </div>

        {/* Leave Balance */}
        <div className="mobile-grid-3 mobile-mb-8">
          <div className="mobile-card mobile-card-soft" style={{ padding: '16px', borderRadius: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--mobile-gray-400)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px' }}>
              Casual
            </span>
            <span style={{ fontSize: '24px', fontWeight: 900, color: 'var(--mobile-primary)' }}>
              {casualLeave.remaining || casualLeave.total || 0}
            </span>
          </div>
          
          <div className="mobile-card mobile-card-soft" style={{ padding: '16px', borderRadius: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--mobile-gray-400)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px' }}>
              Sick
            </span>
            <span style={{ fontSize: '24px', fontWeight: 900, color: 'var(--mobile-emerald-500)' }}>
              {sickLeave.remaining || sickLeave.total || 0}
            </span>
          </div>
          
          <div className="mobile-card mobile-card-soft" style={{ padding: '16px', borderRadius: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--mobile-gray-400)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px' }}>
              Used
            </span>
            <span style={{ fontSize: '24px', fontWeight: 900, color: 'var(--mobile-orange-500)' }}>
              {totalUsed}
            </span>
          </div>
        </div>

        {/* Recent Requests Section */}
        <div className="mobile-section-header mobile-mb-6">
          <h3 className="mobile-section-title">Recent Requests</h3>
          <button 
            className="mobile-section-link"
            onClick={() => router.push('/dashboard/leave/requests')}
          >
            View All
          </button>
        </div>

        {/* Requests List */}
        {recentRequests.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {recentRequests.slice(0, 5).map((request, idx) => (
              <div 
                key={request._id || idx}
                className="mobile-card mobile-card-soft"
                style={{ 
                  padding: '16px', 
                  borderRadius: '16px',
                  cursor: 'pointer',
                  transition: 'transform 0.2s'
                }}
                onClick={() => router.push(`/dashboard/leave/${request._id}`)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                  <div>
                    <h4 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--mobile-gray-900)' }}>
                      {request.leaveType?.name || request.type || 'Leave Request'}
                    </h4>
                    <p style={{ fontSize: '12px', fontWeight: 500, color: 'var(--mobile-gray-400)', marginTop: '4px' }}>
                      {formatDateRange(request.startDate, request.endDate)}
                    </p>
                  </div>
                  <span className={`mobile-badge mobile-badge-pill mobile-badge-${getStatusColor(request.status)}`}>
                    {request.status}
                  </span>
                </div>
                {request.reason && (
                  <p style={{ fontSize: '12px', fontWeight: 500, color: 'var(--mobile-gray-500)', lineHeight: 1.5 }}>
                    {request.reason.substring(0, 100)}{request.reason.length > 100 ? '...' : ''}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="mobile-empty" style={{ minHeight: '300px', borderRadius: '40px' }}>
            <div className="mobile-empty-icon">
              <span className="material-icons-outlined">event_busy</span>
            </div>
            <h4 className="mobile-empty-title">No leave requests found</h4>
            <p className="mobile-empty-text">
              You haven't made any leave requests yet. Use the button above to apply.
            </p>
          </div>
        )}
      </div>
    </MobileLayout>
  );
}
