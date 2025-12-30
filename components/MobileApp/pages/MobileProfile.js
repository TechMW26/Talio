'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '../components/MobileLayout';
import '@/components/MobileApp/styles/mobile.css';

/**
 * Mobile Profile Page
 * User profile view optimized for mobile
 */
export default function MobileProfile({ 
  user, 
  employee,
  departments = [],
  emergencyContact = {}
}) {
  const router = useRouter();

  // Get full name
  const getFullName = () => {
    if (employee?.firstName) {
      return `${employee.firstName} ${employee.lastName || ''}`.trim();
    }
    return user?.email?.split('@')[0] || 'User';
  };

  // Employment details sections
  const employmentSections = [
    { label: 'Employment Type', value: employee?.employmentType || 'N/A', color: 'teal' },
    { label: 'Department(s)', value: employee?.department?.name || departments[0]?.name || 'N/A', color: 'blue' },
    { label: 'Designation', value: employee?.designation?.name ? `(${employee.designation.level || 'Entry Level'}) - ${employee.designation.name}` : 'N/A', color: 'purple' },
    { label: 'Reporting Manager', value: employee?.reportingManager?.firstName ? `${employee.reportingManager.firstName} ${employee.reportingManager.lastName || ''}` : 'N/A', color: 'amber' },
    { label: 'Work Location', value: employee?.workLocation || 'N/A', color: 'cyan' },
  ];

  // Personal details
  const personalDetails = [
    { 
      label: 'Email Address', 
      value: user?.email || employee?.email || 'N/A', 
      sub: 'This field is managed by your organization.', 
      icon: 'email', 
      color: 'blue' 
    },
    { 
      label: 'Phone Number', 
      value: employee?.phone || 'N/A', 
      icon: 'call', 
      color: 'green' 
    },
    { 
      label: 'Date of Birth', 
      value: employee?.dateOfBirth ? new Date(employee.dateOfBirth).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : 'N/A', 
      icon: 'calendar_today', 
      color: 'purple',
      verified: employee?.dateOfBirth ? true : false
    },
    { 
      label: 'Gender', 
      value: employee?.gender ? employee.gender.charAt(0).toUpperCase() + employee.gender.slice(1) : 'N/A', 
      icon: 'person', 
      color: 'pink' 
    },
    { 
      label: 'Address', 
      value: employee?.address || 'N/A', 
      icon: 'place', 
      color: 'red' 
    },
  ];

  // Get color variable
  const getColorVar = (color) => {
    if (color === 'pink') return 'red';
    return color;
  };

  return (
    <MobileLayout title="Profile" user={user}>
      <div className="mobile-page" style={{ paddingBottom: '128px' }}>
        {/* Employment Details */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '32px' }}>
          {employmentSections.map((sec, i) => (
            <div 
              key={i} 
              style={{
                background: `var(--mobile-${getColorVar(sec.color)}-50)`,
                padding: '20px',
                borderRadius: '20px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                cursor: 'pointer',
                transition: 'transform 0.2s'
              }}
            >
              <p style={{ 
                fontSize: '10px', 
                fontWeight: 900, 
                color: `var(--mobile-${getColorVar(sec.color)}-600)`, 
                textTransform: 'uppercase', 
                letterSpacing: '0.15em',
                marginBottom: '4px'
              }}>
                {sec.label}
              </p>
              <p style={{ fontSize: '18px', fontWeight: 700, color: 'var(--mobile-gray-900)' }}>
                {sec.value}
              </p>
            </div>
          ))}
        </div>

        {/* Emergency Contact */}
        <div className="mobile-card mobile-card-soft" style={{ borderRadius: '32px', padding: '24px', marginBottom: '32px' }}>
          <h3 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--mobile-gray-900)', marginBottom: '8px' }}>
            Emergency Contact
          </h3>
          <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--mobile-gray-400)', marginBottom: '24px', lineHeight: 1.5 }}>
            Person we should reach out to in case of any emergency.
          </p>
          <div style={{
            background: 'var(--mobile-red-50)',
            padding: '20px',
            borderRadius: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '16px'
          }}>
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: '16px',
              background: 'rgba(255,255,255,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--mobile-red-500)'
            }}>
              <span className="material-icons-outlined">contact_phone</span>
            </div>
            <div>
              <p style={{ fontSize: '9px', fontWeight: 900, color: 'var(--mobile-red-500)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '2px' }}>
                {emergencyContact?.name ? 'Emergency Contact' : 'Emergency Name'}
              </p>
              <p style={{ fontSize: '16px', fontWeight: 700, color: 'var(--mobile-gray-900)' }}>
                {emergencyContact?.name || 'Not Provided'}
              </p>
              {emergencyContact?.phone && (
                <p style={{ fontSize: '12px', fontWeight: 500, color: 'var(--mobile-gray-500)', marginTop: '4px' }}>
                  {emergencyContact.phone}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Divider */}
        <div style={{ height: '1px', background: 'var(--mobile-gray-100)', margin: '32px 0' }} />

        {/* Basic Details Header */}
        <div style={{ padding: '0 4px', marginBottom: '24px' }}>
          <h3 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--mobile-gray-900)', marginBottom: '4px' }}>
            Basic Details
          </h3>
          <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--mobile-gray-400)' }}>
            Basic details that help us identify and contact you.
          </p>
        </div>

        {/* Personal Details */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {personalDetails.map((det, i) => (
            <div 
              key={i}
              style={{
                background: `var(--mobile-${getColorVar(det.color)}-50)`,
                padding: '20px',
                borderRadius: '20px',
                display: 'flex',
                gap: '20px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                cursor: 'pointer',
                transition: 'transform 0.2s'
              }}
            >
              <div style={{
                flexShrink: 0,
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                background: `var(--mobile-${getColorVar(det.color)}-500)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                boxShadow: `0 4px 6px var(--mobile-${getColorVar(det.color)}-500, 0.2)`
              }}>
                <span className="material-icons-outlined" style={{ fontSize: '20px' }}>{det.icon}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ 
                  fontSize: '10px', 
                  fontWeight: 900, 
                  color: `var(--mobile-${getColorVar(det.color)}-600)`, 
                  textTransform: 'uppercase', 
                  letterSpacing: '0.1em',
                  marginBottom: '4px'
                }}>
                  {det.label}
                </p>
                <p style={{ 
                  fontSize: '16px', 
                  fontWeight: 700, 
                  color: 'var(--mobile-gray-900)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  lineHeight: 1.3
                }}>
                  {det.value}
                </p>
                {det.sub && (
                  <p style={{ 
                    fontSize: '10px', 
                    fontWeight: 700, 
                    color: 'var(--mobile-primary)', 
                    marginTop: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    <span className="material-icons-outlined" style={{ fontSize: '12px' }}>info</span>
                    {det.sub}
                  </p>
                )}
                {det.verified && (
                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '4px 12px',
                    background: 'var(--mobile-green-100)',
                    color: 'var(--mobile-green-700)',
                    borderRadius: '8px',
                    fontSize: '10px',
                    fontWeight: 900,
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    marginTop: '12px'
                  }}>
                    <span className="material-icons-round" style={{ fontSize: '12px' }}>check_circle</span>
                    Verified
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Edit Profile Button */}
        <div style={{ marginTop: '32px' }}>
          <button 
            className="mobile-btn mobile-btn-primary mobile-btn-full mobile-btn-lg mobile-btn-rounded"
            onClick={() => router.push('/dashboard/profile/edit')}
          >
            <span className="material-icons-round">edit</span>
            Edit Profile
          </button>
        </div>
      </div>
    </MobileLayout>
  );
}
