'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '../components/MobileLayout';
import '@/components/MobileApp/styles/mobile.css';

/**
 * Mobile Attendance List Page
 * Calendar and list view of attendance history
 */
export default function MobileAttendanceList({ 
  user, 
  attendanceRecords = [],
  currentMonth,
  currentYear 
}) {
  const router = useRouter();
  const [viewMode, setViewMode] = useState('list'); // 'calendar' | 'list'
  const [selectedMonth, setSelectedMonth] = useState(currentMonth || new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(currentYear || new Date().getFullYear());

  // Format date for display
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Format time for display
  const formatTime = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  // Get month name
  const getMonthName = () => {
    const date = new Date(selectedYear, selectedMonth);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  // Navigate months
  const goToPrevMonth = () => {
    if (selectedMonth === 0) {
      setSelectedMonth(11);
      setSelectedYear(selectedYear - 1);
    } else {
      setSelectedMonth(selectedMonth - 1);
    }
  };

  const goToNextMonth = () => {
    if (selectedMonth === 11) {
      setSelectedMonth(0);
      setSelectedYear(selectedYear + 1);
    } else {
      setSelectedMonth(selectedMonth + 1);
    }
  };

  // Get status color
  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'present': return 'green';
      case 'absent': return 'red';
      case 'half-day': return 'yellow';
      case 'on-leave': case 'leave': return 'blue';
      case 'holiday': return 'purple';
      case 'in-progress': return 'orange';
      default: return 'gray';
    }
  };

  // Get status label
  const getStatusLabel = (status, checkIn, checkOut) => {
    if (status) return status.charAt(0).toUpperCase() + status.slice(1).replace('-', ' ');
    if (checkIn && !checkOut) return 'In Progress';
    if (!checkIn) return 'No Record';
    return 'Present';
  };

  // Legend items
  const legendItems = [
    { color: 'bg-green-500', label: 'Present' },
    { color: 'border border-orange-500', label: 'In Progress' },
    { color: 'bg-yellow-400', label: 'Half Day' },
    { color: 'border border-yellow-500', label: 'Late' },
    { color: 'bg-red-400 opacity-50', label: 'Absent' },
    { color: 'bg-blue-400 opacity-50', label: 'On Leave' },
    { color: 'border border-purple-400', label: 'Holiday' },
    { color: 'border border-gray-300', label: 'No Record' }
  ];

  return (
    <MobileLayout title="Attendance History" user={user}>
      <div className="mobile-page">
        {/* View Toggle */}
        <div className="mobile-tab-bar mobile-mb-8">
          <button 
            className={`mobile-tab ${viewMode === 'calendar' ? 'mobile-tab-active' : 'mobile-tab-inactive'}`}
            onClick={() => setViewMode('calendar')}
          >
            <span className="material-icons-round" style={{ fontSize: '18px' }}>calendar_month</span>
            Calendar
          </button>
          <button 
            className={`mobile-tab ${viewMode === 'list' ? 'mobile-tab-active' : 'mobile-tab-inactive'}`}
            onClick={() => setViewMode('list')}
          >
            <span className="material-icons-round" style={{ fontSize: '18px' }}>format_list_bulleted</span>
            List
          </button>
        </div>

        {/* Month Navigation */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', padding: '0 8px' }}>
          <button 
            onClick={goToPrevMonth}
            style={{ padding: '8px', background: 'white', borderRadius: '50%', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', border: 'none', cursor: 'pointer' }}
          >
            <span className="material-icons-round" style={{ color: 'var(--mobile-gray-400)' }}>chevron_left</span>
          </button>
          <h3 style={{ fontSize: '18px', fontWeight: 700 }}>{getMonthName()}</h3>
          <button 
            onClick={goToNextMonth}
            style={{ padding: '8px', background: 'white', borderRadius: '50%', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', border: 'none', cursor: 'pointer' }}
          >
            <span className="material-icons-round" style={{ color: 'var(--mobile-gray-400)' }}>chevron_right</span>
          </button>
        </div>

        {/* Legend */}
        <div className="mobile-card mobile-card-soft mobile-mb-8" style={{ borderRadius: '24px', padding: '24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
            {legendItems.map((item, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  ...(item.color.includes('border') ? { border: '2px solid' } : { background: item.color.replace('bg-', '').includes('green') ? 'var(--mobile-green-500)' : 
                    item.color.includes('red') ? 'var(--mobile-red-500)' :
                    item.color.includes('yellow') ? 'var(--mobile-yellow-400)' :
                    item.color.includes('blue') ? 'var(--mobile-blue-400)' :
                    item.color.includes('purple') ? 'var(--mobile-purple-400)' :
                    item.color.includes('orange') ? 'var(--mobile-orange-500)' : 'var(--mobile-gray-300)' }),
                  borderColor: item.color.includes('orange') ? 'var(--mobile-orange-500)' :
                    item.color.includes('yellow') ? 'var(--mobile-yellow-500)' :
                    item.color.includes('purple') ? 'var(--mobile-purple-400)' :
                    item.color.includes('gray') ? 'var(--mobile-gray-300)' : 'transparent',
                  opacity: item.color.includes('opacity') ? 0.5 : 1
                }} />
                <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--mobile-gray-400)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Attendance Table */}
        <div className="mobile-table">
          <div className="mobile-table-header" style={{ gridTemplateColumns: '5fr 3fr 3fr 1fr' }}>
            <div>Date</div>
            <div style={{ textAlign: 'center' }}>Check In</div>
            <div style={{ textAlign: 'center' }}>Check Out</div>
            <div style={{ textAlign: 'right' }}>H</div>
          </div>
          
          {attendanceRecords.length > 0 ? (
            <div>
              {attendanceRecords.map((record, idx) => (
                <div 
                  key={idx} 
                  className="mobile-table-row"
                  style={{ gridTemplateColumns: '5fr 3fr 3fr 1fr' }}
                  onClick={() => router.push(`/dashboard/attendance/edit/${record._id}`)}
                >
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--mobile-gray-900)' }}>
                      {formatDate(record.date)}
                    </span>
                    <span style={{ 
                      fontSize: '10px', 
                      fontWeight: 700, 
                      color: `var(--mobile-${getStatusColor(record.status)}-500)`,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      marginTop: '2px'
                    }}>
                      <div style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        background: `var(--mobile-${getStatusColor(record.status)}-500)`
                      }} />
                      {getStatusLabel(record.status, record.checkIn, record.checkOut)}
                    </span>
                  </div>
                  <div style={{ textAlign: 'center', fontSize: '14px', fontWeight: 500, color: 'var(--mobile-gray-900)' }}>
                    {formatTime(record.checkIn)}
                  </div>
                  <div style={{ textAlign: 'center', fontSize: '14px', fontWeight: 500, color: 'var(--mobile-gray-400)' }}>
                    {formatTime(record.checkOut)}
                  </div>
                  <div style={{ textAlign: 'right', fontSize: '14px', fontWeight: 900, color: 'var(--mobile-gray-900)' }}>
                    {record.workHours ? `${Math.floor(record.workHours)}` : 'N'}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mobile-empty" style={{ minHeight: '200px' }}>
              <div className="mobile-empty-icon">
                <span className="material-icons-outlined">event_busy</span>
              </div>
              <h4 className="mobile-empty-title">No records found</h4>
              <p className="mobile-empty-text">No attendance records for this period</p>
            </div>
          )}
        </div>
      </div>
    </MobileLayout>
  );
}
