'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '../components/MobileLayout';
import '@/components/MobileApp/styles/mobile.css';

/**
 * Mobile Helpdesk Page
 * Support ticket management for mobile
 */
export default function MobileHelpdesk({ 
  user, 
  tickets = [],
  stats = {}
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('all');

  // Default stats
  const ticketStats = {
    open: stats.open || tickets.filter(t => t.status === 'open').length,
    inProgress: stats.inProgress || tickets.filter(t => t.status === 'in-progress' || t.status === 'in_progress').length,
    resolved: stats.resolved || tickets.filter(t => t.status === 'resolved' || t.status === 'closed').length,
    total: stats.total || tickets.length
  };

  // Filter tickets by tab
  const filteredTickets = activeTab === 'all' 
    ? tickets 
    : tickets.filter(t => {
        if (activeTab === 'open') return t.status === 'open';
        if (activeTab === 'progress') return t.status === 'in-progress' || t.status === 'in_progress';
        if (activeTab === 'resolved') return t.status === 'resolved' || t.status === 'closed';
        return true;
      });

  // Get status color
  const getStatusColor = (status) => {
    switch(status?.toLowerCase()) {
      case 'open': return 'orange';
      case 'in-progress':
      case 'in_progress': return 'blue';
      case 'resolved':
      case 'closed': return 'green';
      default: return 'gray';
    }
  };

  // Get status label
  const getStatusLabel = (status) => {
    switch(status?.toLowerCase()) {
      case 'open': return 'Open';
      case 'in-progress':
      case 'in_progress': return 'In Progress';
      case 'resolved': return 'Resolved';
      case 'closed': return 'Closed';
      default: return status;
    }
  };

  // Get priority icon
  const getPriorityIcon = (priority) => {
    switch(priority?.toLowerCase()) {
      case 'high': return 'priority_high';
      case 'urgent': return 'warning';
      case 'medium': return 'remove';
      case 'low': return 'arrow_downward';
      default: return 'remove';
    }
  };

  // Format date
  const formatDate = (date) => {
    if (!date) return '';
    const d = new Date(date);
    const now = new Date();
    const diffMs = now - d;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <MobileLayout title="Helpdesk" user={user}>
      <div className="mobile-page">
        {/* Page Header */}
        <div className="mobile-mb-6">
          <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', color: 'var(--mobile-gray-900)' }}>
            Helpdesk
          </h2>
          <p style={{ color: 'var(--mobile-gray-400)', fontSize: '14px', fontWeight: 500 }}>
            Get support and track your requests
          </p>
        </div>

        {/* Create Ticket Button */}
        <button 
          className="mobile-btn mobile-btn-primary mobile-btn-full mobile-btn-rounded mobile-mb-6"
          onClick={() => router.push('/dashboard/helpdesk/create')}
          style={{ 
            padding: '20px 24px',
            fontSize: '12px',
            fontWeight: 900,
            textTransform: 'uppercase',
            letterSpacing: '0.15em'
          }}
        >
          <span className="material-icons-round" style={{ fontSize: '20px' }}>add</span>
          Create New Ticket
        </button>

        {/* Stats Cards */}
        <div className="mobile-stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '24px' }}>
          <div className="mobile-card mobile-card-soft" style={{ padding: '16px', borderRadius: '20px', textAlign: 'center' }}>
            <p style={{ fontSize: '28px', fontWeight: 900, color: 'var(--mobile-orange-500)' }}>{ticketStats.open}</p>
            <p style={{ fontSize: '10px', fontWeight: 700, color: 'var(--mobile-gray-400)', textTransform: 'uppercase', marginTop: '4px' }}>Open</p>
          </div>
          <div className="mobile-card mobile-card-soft" style={{ padding: '16px', borderRadius: '20px', textAlign: 'center' }}>
            <p style={{ fontSize: '28px', fontWeight: 900, color: 'var(--mobile-blue-500)' }}>{ticketStats.inProgress}</p>
            <p style={{ fontSize: '10px', fontWeight: 700, color: 'var(--mobile-gray-400)', textTransform: 'uppercase', marginTop: '4px' }}>In Progress</p>
          </div>
          <div className="mobile-card mobile-card-soft" style={{ padding: '16px', borderRadius: '20px', textAlign: 'center' }}>
            <p style={{ fontSize: '28px', fontWeight: 900, color: 'var(--mobile-green-500)' }}>{ticketStats.resolved}</p>
            <p style={{ fontSize: '10px', fontWeight: 700, color: 'var(--mobile-gray-400)', textTransform: 'uppercase', marginTop: '4px' }}>Resolved</p>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="mobile-tabs mobile-mb-6">
          {[
            { id: 'all', label: 'All' },
            { id: 'open', label: 'Open' },
            { id: 'progress', label: 'In Progress' },
            { id: 'resolved', label: 'Resolved' }
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

        {/* Ticket List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filteredTickets.map((ticket, idx) => (
            <div 
              key={ticket._id || idx}
              className="mobile-card mobile-card-soft"
              style={{ 
                padding: '20px',
                borderRadius: '20px',
                cursor: 'pointer'
              }}
              onClick={() => router.push(`/dashboard/helpdesk/${ticket._id}`)}
            >
              {/* Ticket Header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--mobile-gray-400)', textTransform: 'uppercase' }}>
                    #{ticket.ticketId || ticket._id?.slice(-6)}
                  </span>
                  <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--mobile-gray-900)', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ticket.subject || ticket.title}
                  </h3>
                </div>
                <span 
                  className={`mobile-badge mobile-badge-${getStatusColor(ticket.status)}`}
                  style={{ marginLeft: '12px', flexShrink: 0 }}
                >
                  {getStatusLabel(ticket.status)}
                </span>
              </div>

              {/* Ticket Description */}
              <p style={{ fontSize: '14px', fontWeight: 500, color: 'var(--mobile-gray-500)', marginBottom: '16px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {ticket.description || ticket.message}
              </p>

              {/* Ticket Footer */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {ticket.priority && (
                    <span style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '4px', 
                      fontSize: '12px', 
                      fontWeight: 600,
                      color: ticket.priority === 'high' || ticket.priority === 'urgent' ? 'var(--mobile-red-500)' : 'var(--mobile-gray-400)'
                    }}>
                      <span className="material-icons-round" style={{ fontSize: '14px' }}>{getPriorityIcon(ticket.priority)}</span>
                      {ticket.priority}
                    </span>
                  )}
                  {ticket.category && (
                    <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--mobile-gray-400)', background: 'var(--mobile-gray-100)', padding: '2px 8px', borderRadius: '6px' }}>
                      {ticket.category}
                    </span>
                  )}
                </div>
                <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--mobile-gray-400)' }}>
                  {formatDate(ticket.createdAt)}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Empty State */}
        {filteredTickets.length === 0 && (
          <div className="mobile-empty">
            <div className="mobile-empty-icon">
              <span className="material-icons-outlined">support_agent</span>
            </div>
            <h4 className="mobile-empty-title">
              {activeTab === 'all' ? 'No tickets yet' : `No ${activeTab} tickets`}
            </h4>
            <p className="mobile-empty-text">
              {activeTab === 'all' 
                ? 'Create a ticket to get help from support' 
                : 'No tickets match this filter'}
            </p>
          </div>
        )}
      </div>
    </MobileLayout>
  );
}
