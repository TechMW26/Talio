'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '../components/MobileLayout';
import '@/components/MobileApp/styles/mobile.css';

/**
 * Mobile Ideas Page
 * Ideas sandbox / suggestion box for mobile
 */
export default function MobileIdeas({ 
  user, 
  ideas = [],
  myIdeas = []
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('all');
  const [showNewIdea, setShowNewIdea] = useState(false);
  const [newIdea, setNewIdea] = useState({ title: '', description: '', category: '' });

  // Filter ideas
  const displayedIdeas = activeTab === 'mine' ? myIdeas : ideas;

  // Categories for ideas
  const categories = [
    { id: 'product', label: 'Product', icon: 'inventory_2', color: 'blue' },
    { id: 'process', label: 'Process', icon: 'settings_suggest', color: 'green' },
    { id: 'culture', label: 'Culture', icon: 'diversity_3', color: 'purple' },
    { id: 'tech', label: 'Technology', icon: 'memory', color: 'indigo' },
    { id: 'other', label: 'Other', icon: 'lightbulb', color: 'amber' }
  ];

  // Get category info
  const getCategoryInfo = (categoryId) => {
    return categories.find(c => c.id === categoryId) || categories[4];
  };

  // Format date
  const formatDate = (date) => {
    if (!date) return '';
    const d = new Date(date);
    const now = new Date();
    const diffMs = now - d;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays < 1) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Get status color
  const getStatusColor = (status) => {
    switch(status?.toLowerCase()) {
      case 'approved': return 'green';
      case 'reviewing':
      case 'under-review': return 'blue';
      case 'implemented': return 'indigo';
      case 'rejected': return 'red';
      default: return 'gray';
    }
  };

  // Handle submit new idea
  const handleSubmitIdea = () => {
    if (!newIdea.title.trim()) return;
    // In real app, call API
    console.log('Submitting idea:', newIdea);
    setShowNewIdea(false);
    setNewIdea({ title: '', description: '', category: '' });
  };

  // New Idea Form
  if (showNewIdea) {
    return (
      <MobileLayout title="New Idea" user={user} showBack onBack={() => setShowNewIdea(false)}>
        <div className="mobile-page">
          <div className="mobile-mb-6">
            <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', color: 'var(--mobile-gray-900)' }}>
              Share Your Idea
            </h2>
            <p style={{ color: 'var(--mobile-gray-400)', fontSize: '14px', fontWeight: 500 }}>
              Help us improve with your suggestions
            </p>
          </div>

          {/* Category Selection */}
          <div className="mobile-mb-6">
            <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--mobile-gray-500)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px', display: 'block' }}>
              Category
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setNewIdea(prev => ({ ...prev, category: cat.id }))}
                  style={{
                    padding: '16px 12px',
                    borderRadius: '16px',
                    border: `2px solid ${newIdea.category === cat.id ? `var(--mobile-${cat.color}-500)` : 'var(--mobile-gray-100)'}`,
                    background: newIdea.category === cat.id ? `var(--mobile-${cat.color}-50)` : 'var(--mobile-gray-50)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  <span 
                    className="material-icons-round" 
                    style={{ 
                      fontSize: '24px', 
                      color: newIdea.category === cat.id ? `var(--mobile-${cat.color}-500)` : 'var(--mobile-gray-400)' 
                    }}
                  >
                    {cat.icon}
                  </span>
                  <span style={{ 
                    fontSize: '11px', 
                    fontWeight: 600, 
                    color: newIdea.category === cat.id ? `var(--mobile-${cat.color}-600)` : 'var(--mobile-gray-500)' 
                  }}>
                    {cat.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Title Input */}
          <div className="mobile-mb-6">
            <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--mobile-gray-500)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', display: 'block' }}>
              Title
            </label>
            <input
              type="text"
              placeholder="Give your idea a title"
              value={newIdea.title}
              onChange={e => setNewIdea(prev => ({ ...prev, title: e.target.value }))}
              className="mobile-input"
              style={{
                width: '100%',
                padding: '16px 20px',
                borderRadius: '16px',
                border: '2px solid var(--mobile-gray-100)',
                fontSize: '16px',
                fontWeight: 500,
                outline: 'none',
                background: 'var(--mobile-gray-50)'
              }}
            />
          </div>

          {/* Description Input */}
          <div className="mobile-mb-6">
            <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--mobile-gray-500)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', display: 'block' }}>
              Description
            </label>
            <textarea
              placeholder="Describe your idea in detail..."
              value={newIdea.description}
              onChange={e => setNewIdea(prev => ({ ...prev, description: e.target.value }))}
              rows={6}
              style={{
                width: '100%',
                padding: '16px 20px',
                borderRadius: '16px',
                border: '2px solid var(--mobile-gray-100)',
                fontSize: '16px',
                fontWeight: 500,
                outline: 'none',
                resize: 'none',
                fontFamily: 'inherit',
                background: 'var(--mobile-gray-50)'
              }}
            />
          </div>

          {/* Submit Button */}
          <button 
            className="mobile-btn mobile-btn-primary mobile-btn-full mobile-btn-rounded"
            onClick={handleSubmitIdea}
            disabled={!newIdea.title.trim()}
            style={{ 
              padding: '20px 24px',
              fontSize: '14px',
              fontWeight: 700,
              opacity: !newIdea.title.trim() ? 0.5 : 1
            }}
          >
            <span className="material-icons-round" style={{ fontSize: '20px' }}>send</span>
            Submit Idea
          </button>
        </div>
      </MobileLayout>
    );
  }

  // Ideas List View
  return (
    <MobileLayout title="Ideas" user={user}>
      <div className="mobile-page">
        {/* Page Header */}
        <div className="mobile-mb-6">
          <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', color: 'var(--mobile-gray-900)' }}>
            Ideas Sandbox
          </h2>
          <p style={{ color: 'var(--mobile-gray-400)', fontSize: '14px', fontWeight: 500 }}>
            Share and discover innovative ideas
          </p>
        </div>

        {/* New Idea Button */}
        <button 
          className="mobile-btn mobile-btn-primary mobile-btn-full mobile-btn-rounded mobile-mb-6"
          onClick={() => setShowNewIdea(true)}
          style={{ 
            padding: '20px 24px',
            fontSize: '12px',
            fontWeight: 900,
            textTransform: 'uppercase',
            letterSpacing: '0.15em'
          }}
        >
          <span className="material-icons-round" style={{ fontSize: '20px' }}>lightbulb</span>
          Share Your Idea
        </button>

        {/* Filter Tabs */}
        <div className="mobile-tabs mobile-mb-6">
          <button 
            className={`mobile-tab ${activeTab === 'all' ? 'mobile-tab-active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            All Ideas
          </button>
          <button 
            className={`mobile-tab ${activeTab === 'mine' ? 'mobile-tab-active' : ''}`}
            onClick={() => setActiveTab('mine')}
          >
            My Ideas
          </button>
        </div>

        {/* Ideas List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {displayedIdeas.map((idea, idx) => {
            const catInfo = getCategoryInfo(idea.category);
            return (
              <div 
                key={idea._id || idx}
                className="mobile-card mobile-card-soft"
                style={{ 
                  padding: '20px',
                  borderRadius: '20px',
                  cursor: 'pointer'
                }}
                onClick={() => router.push(`/dashboard/ideas/${idea._id}`)}
              >
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', marginBottom: '12px' }}>
                  <div style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '14px',
                    background: `var(--mobile-${catInfo.color}-50)`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: `var(--mobile-${catInfo.color}-500)`,
                    flexShrink: 0
                  }}>
                    <span className="material-icons-round" style={{ fontSize: '24px' }}>{catInfo.icon}</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--mobile-gray-900)', marginBottom: '4px' }}>
                      {idea.title}
                    </h3>
                    <p style={{ fontSize: '12px', fontWeight: 500, color: 'var(--mobile-gray-400)' }}>
                      {idea.author?.name || 'Anonymous'} • {formatDate(idea.createdAt)}
                    </p>
                  </div>
                </div>

                {/* Description */}
                <p style={{ 
                  fontSize: '14px', 
                  fontWeight: 500, 
                  color: 'var(--mobile-gray-500)', 
                  marginBottom: '16px',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden'
                }}>
                  {idea.description}
                </p>

                {/* Footer */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    {/* Upvotes */}
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '14px', fontWeight: 600, color: 'var(--mobile-gray-500)' }}>
                      <span className="material-icons-round" style={{ fontSize: '18px' }}>thumb_up</span>
                      {idea.upvotes || 0}
                    </span>
                    {/* Comments */}
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '14px', fontWeight: 600, color: 'var(--mobile-gray-500)' }}>
                      <span className="material-icons-round" style={{ fontSize: '18px' }}>chat_bubble_outline</span>
                      {idea.comments?.length || 0}
                    </span>
                  </div>
                  {idea.status && (
                    <span className={`mobile-badge mobile-badge-${getStatusColor(idea.status)}`}>
                      {idea.status}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Empty State */}
        {displayedIdeas.length === 0 && (
          <div className="mobile-empty">
            <div className="mobile-empty-icon">
              <span className="material-icons-outlined">lightbulb</span>
            </div>
            <h4 className="mobile-empty-title">
              {activeTab === 'mine' ? 'No ideas yet' : 'No ideas shared'}
            </h4>
            <p className="mobile-empty-text">
              {activeTab === 'mine' 
                ? 'Share your first idea to make a difference' 
                : 'Be the first to share an innovative idea'}
            </p>
            <button 
              className="mobile-btn mobile-btn-primary mobile-btn-rounded"
              onClick={() => setShowNewIdea(true)}
              style={{ marginTop: '16px', padding: '12px 24px' }}
            >
              <span className="material-icons-round" style={{ fontSize: '18px' }}>add</span>
              Share Idea
            </button>
          </div>
        )}
      </div>
    </MobileLayout>
  );
}
