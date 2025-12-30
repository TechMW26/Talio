'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '../components/MobileLayout';
import '@/components/MobileApp/styles/mobile.css';

/**
 * Mobile Trainings Page
 * Training and learning management for mobile
 */
export default function MobileTrainings({ 
  user, 
  trainings = [],
  stats = {}
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('all');

  // Calculate progress stats
  const trainingStats = {
    total: stats.total || trainings.length,
    inProgress: stats.inProgress || trainings.filter(t => t.status === 'in-progress' || (t.progress > 0 && t.progress < 100)).length,
    completed: stats.completed || trainings.filter(t => t.status === 'completed' || t.progress === 100).length,
    notStarted: stats.notStarted || trainings.filter(t => t.status === 'not-started' || t.progress === 0 || !t.progress).length
  };

  // Filter trainings by tab
  const filteredTrainings = activeTab === 'all' 
    ? trainings 
    : trainings.filter(t => {
        if (activeTab === 'progress') return t.status === 'in-progress' || (t.progress > 0 && t.progress < 100);
        if (activeTab === 'completed') return t.status === 'completed' || t.progress === 100;
        if (activeTab === 'pending') return t.status === 'not-started' || t.progress === 0 || !t.progress;
        return true;
      });

  // Get category icon
  const getCategoryIcon = (category) => {
    switch(category?.toLowerCase()) {
      case 'technical': return 'code';
      case 'soft-skills':
      case 'soft skills': return 'psychology';
      case 'compliance': return 'verified_user';
      case 'leadership': return 'groups';
      case 'safety': return 'health_and_safety';
      default: return 'school';
    }
  };

  // Get progress color
  const getProgressColor = (progress) => {
    if (progress >= 100) return 'var(--mobile-green-500)';
    if (progress >= 50) return 'var(--mobile-blue-500)';
    if (progress > 0) return 'var(--mobile-orange-500)';
    return 'var(--mobile-gray-300)';
  };

  // Format duration
  const formatDuration = (minutes) => {
    if (!minutes) return '';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  return (
    <MobileLayout title="Trainings" user={user}>
      <div className="mobile-page">
        {/* Page Header */}
        <div className="mobile-mb-6">
          <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', color: 'var(--mobile-gray-900)' }}>
            Trainings
          </h2>
          <p style={{ color: 'var(--mobile-gray-400)', fontSize: '14px', fontWeight: 500 }}>
            Continue your learning journey
          </p>
        </div>

        {/* Overall Progress Card */}
        <div 
          className="mobile-card"
          style={{ 
            background: 'linear-gradient(135deg, var(--mobile-indigo-500), var(--mobile-purple-500))',
            color: 'white',
            padding: '24px',
            borderRadius: '24px',
            marginBottom: '24px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontSize: '12px', fontWeight: 600, opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Learning Progress
              </p>
              <p style={{ fontSize: '40px', fontWeight: 900, marginTop: '8px' }}>
                {trainingStats.total > 0 ? Math.round((trainingStats.completed / trainingStats.total) * 100) : 0}%
              </p>
              <p style={{ fontSize: '14px', fontWeight: 500, opacity: 0.9, marginTop: '4px' }}>
                {trainingStats.completed} of {trainingStats.total} completed
              </p>
            </div>
            <div style={{
              width: '80px',
              height: '80px',
              borderRadius: '20px',
              background: 'rgba(255,255,255,0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <span className="material-icons-round" style={{ fontSize: '40px' }}>school</span>
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '24px' }}>
          <div className="mobile-card mobile-card-soft" style={{ padding: '16px', borderRadius: '16px', textAlign: 'center' }}>
            <p style={{ fontSize: '24px', fontWeight: 900, color: 'var(--mobile-orange-500)' }}>{trainingStats.inProgress}</p>
            <p style={{ fontSize: '10px', fontWeight: 700, color: 'var(--mobile-gray-400)', textTransform: 'uppercase', marginTop: '4px' }}>In Progress</p>
          </div>
          <div className="mobile-card mobile-card-soft" style={{ padding: '16px', borderRadius: '16px', textAlign: 'center' }}>
            <p style={{ fontSize: '24px', fontWeight: 900, color: 'var(--mobile-green-500)' }}>{trainingStats.completed}</p>
            <p style={{ fontSize: '10px', fontWeight: 700, color: 'var(--mobile-gray-400)', textTransform: 'uppercase', marginTop: '4px' }}>Completed</p>
          </div>
          <div className="mobile-card mobile-card-soft" style={{ padding: '16px', borderRadius: '16px', textAlign: 'center' }}>
            <p style={{ fontSize: '24px', fontWeight: 900, color: 'var(--mobile-gray-400)' }}>{trainingStats.notStarted}</p>
            <p style={{ fontSize: '10px', fontWeight: 700, color: 'var(--mobile-gray-400)', textTransform: 'uppercase', marginTop: '4px' }}>Not Started</p>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="mobile-tabs mobile-mb-6">
          {[
            { id: 'all', label: 'All' },
            { id: 'progress', label: 'In Progress' },
            { id: 'pending', label: 'Not Started' },
            { id: 'completed', label: 'Completed' }
          ].map(tab => (
            <button 
              key={tab.id}
              className={`mobile-tab ${activeTab === tab.id ? 'mobile-tab-active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Training List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {filteredTrainings.map((training, idx) => (
            <div 
              key={training._id || idx}
              className="mobile-card mobile-card-soft"
              style={{ 
                padding: '20px',
                borderRadius: '20px',
                cursor: 'pointer'
              }}
              onClick={() => router.push(`/dashboard/trainings/${training._id}`)}
            >
              {/* Training Header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', marginBottom: '16px' }}>
                <div style={{
                  width: '52px',
                  height: '52px',
                  borderRadius: '14px',
                  background: 'var(--mobile-primary-50)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--mobile-primary)',
                  flexShrink: 0
                }}>
                  <span className="material-icons-round" style={{ fontSize: '26px' }}>{getCategoryIcon(training.category)}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--mobile-gray-900)', marginBottom: '4px' }}>
                    {training.title || training.name}
                  </h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    {training.category && (
                      <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--mobile-gray-400)' }}>
                        {training.category}
                      </span>
                    )}
                    {training.duration && (
                      <>
                        <span style={{ color: 'var(--mobile-gray-300)' }}>•</span>
                        <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--mobile-gray-400)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span className="material-icons-round" style={{ fontSize: '14px' }}>schedule</span>
                          {formatDuration(training.duration)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Progress Bar */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--mobile-gray-500)' }}>Progress</span>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: getProgressColor(training.progress || 0) }}>
                    {training.progress || 0}%
                  </span>
                </div>
                <div className="mobile-progress-bar" style={{ height: '8px', borderRadius: '4px', background: 'var(--mobile-gray-100)' }}>
                  <div 
                    className="mobile-progress-fill"
                    style={{ 
                      width: `${training.progress || 0}%`,
                      height: '100%',
                      borderRadius: '4px',
                      background: getProgressColor(training.progress || 0),
                      transition: 'width 0.3s ease'
                    }}
                  />
                </div>
              </div>

              {/* Deadline */}
              {training.dueDate && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px' }}>
                  <span className="material-icons-round" style={{ fontSize: '14px', color: 'var(--mobile-gray-400)' }}>event</span>
                  <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--mobile-gray-400)' }}>
                    Due: {new Date(training.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Empty State */}
        {filteredTrainings.length === 0 && (
          <div className="mobile-empty">
            <div className="mobile-empty-icon">
              <span className="material-icons-outlined">school</span>
            </div>
            <h4 className="mobile-empty-title">
              {activeTab === 'all' ? 'No trainings assigned' : `No ${activeTab} trainings`}
            </h4>
            <p className="mobile-empty-text">
              {activeTab === 'all' 
                ? 'Check back later for new training modules' 
                : 'No trainings match this filter'}
            </p>
          </div>
        )}
      </div>
    </MobileLayout>
  );
}
