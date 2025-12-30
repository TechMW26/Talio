'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '../components/MobileLayout';
import '@/components/MobileApp/styles/mobile.css';

/**
 * Mobile Tasks Page
 * Task management view optimized for mobile
 */
export default function MobileTasks({ 
  user, 
  tasks = [],
  taskStats = {},
  projects = []
}) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProject, setSelectedProject] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');

  // Task categories
  const categories = [
    { label: 'Total Tasks', value: taskStats.total || 0, icon: 'list', color: 'gray' },
    { label: 'Pending', value: taskStats.pending || 0, icon: 'schedule', color: 'amber', sub: taskStats.pending > 0 ? 'Accept Required' : null },
    { label: 'To Do', value: taskStats.todo || 0, icon: 'playlist_add_check', color: 'sky' },
    { label: 'In Progress', value: taskStats.inProgress || 0, icon: 'play_circle', color: 'blue' },
    { label: 'Completed', value: taskStats.completed || 0, icon: 'check_circle', color: 'emerald' },
    { label: 'Overdue', value: taskStats.overdue || 0, icon: 'warning', color: 'red' },
  ];

  // Get color class for status
  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'completed': case 'done': return 'green';
      case 'in-progress': case 'in progress': return 'blue';
      case 'overdue': return 'red';
      case 'pending': case 'todo': case 'to do': return 'yellow';
      default: return 'gray';
    }
  };

  // Filter tasks
  const filteredTasks = tasks.filter(task => {
    const matchesSearch = !searchQuery || 
      task.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      task.project?.name?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesProject = selectedProject === 'all' || task.project?._id === selectedProject;
    const matchesStatus = selectedStatus === 'all' || task.status?.toLowerCase() === selectedStatus.toLowerCase();
    return matchesSearch && matchesProject && matchesStatus;
  });

  // Format due date
  const formatDueDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Check if overdue
  const isOverdue = (task) => {
    if (!task.dueDate || task.status === 'completed') return false;
    return new Date(task.dueDate) < new Date();
  };

  return (
    <MobileLayout title="Tasks" user={user}>
      <div className="mobile-page">
        {/* Page Header */}
        <div className="mobile-page-header">
          <div className="mobile-page-header-icon">
            <span className="material-icons-round" style={{ fontSize: '24px' }}>assignment</span>
          </div>
          <div>
            <h2 className="mobile-page-title">My Tasks</h2>
            <p className="mobile-page-subtitle">View and manage your tasks across all projects</p>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="mobile-grid-2 mobile-mb-8">
          {categories.map((cat, i) => (
            <div 
              key={i} 
              className="mobile-card mobile-card-soft"
              style={{ 
                padding: '16px', 
                borderRadius: '24px',
                height: '128px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                cursor: 'pointer',
                transition: 'transform 0.2s'
              }}
              onClick={() => setSelectedStatus(cat.label.toLowerCase().replace(' ', '-'))}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '12px',
                  background: `var(--mobile-${cat.color === 'gray' ? 'gray' : cat.color}-50)`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: `var(--mobile-${cat.color === 'gray' ? 'gray' : cat.color}-500)`
                }}>
                  <span className="material-icons-outlined" style={{ fontSize: '20px' }}>{cat.icon}</span>
                </div>
                <span style={{ fontSize: '30px', fontWeight: 900, color: 'var(--mobile-gray-900)' }}>{cat.value}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--mobile-gray-400)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {cat.label}
                </span>
                {cat.sub && (
                  <span style={{ fontSize: '10px', fontWeight: 700, color: `var(--mobile-${cat.color}-600)`, marginTop: '2px' }}>
                    {cat.sub}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Search and Filters */}
        <div style={{ position: 'sticky', top: 0, background: 'var(--mobile-background)', paddingTop: '8px', paddingBottom: '8px', zIndex: 10 }}>
          {/* Search Input */}
          <div style={{ position: 'relative', marginBottom: '12px' }}>
            <span className="material-icons-outlined" style={{ 
              position: 'absolute', 
              left: '16px', 
              top: '50%', 
              transform: 'translateY(-50%)', 
              color: 'var(--mobile-gray-400)',
              fontSize: '18px'
            }}>search</span>
            <input 
              type="text"
              className="mobile-input mobile-input-with-icon"
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ borderRadius: '16px' }}
            />
          </div>
          
          {/* Filter Chips */}
          <div className="mobile-chips mobile-no-scrollbar mobile-mb-6">
            <select
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              style={{
                minWidth: '140px',
                background: 'white',
                padding: '12px 16px',
                borderRadius: '12px',
                border: 'none',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                fontSize: '12px',
                fontWeight: 700,
                color: 'var(--mobile-gray-600)',
                cursor: 'pointer'
              }}
            >
              <option value="all">All Projects</option>
              {projects.map(p => (
                <option key={p._id} value={p._id}>{p.name}</option>
              ))}
            </select>
            
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              style={{
                minWidth: '140px',
                background: 'white',
                padding: '12px 16px',
                borderRadius: '12px',
                border: 'none',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                fontSize: '12px',
                fontWeight: 700,
                color: 'var(--mobile-gray-600)',
                cursor: 'pointer'
              }}
            >
              <option value="all">All Statuses</option>
              <option value="todo">To Do</option>
              <option value="in-progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="overdue">Overdue</option>
            </select>
          </div>
        </div>

        {/* Task List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '48px' }}>
          {filteredTasks.length > 0 ? (
            filteredTasks.map((task, i) => (
              <div 
                key={task._id || i}
                className="mobile-card mobile-card-soft"
                style={{ 
                  padding: '16px', 
                  borderRadius: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  transition: 'transform 0.2s'
                }}
                onClick={() => router.push(`/dashboard/projects/tasks/${task._id}`)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <div style={{
                    width: '6px',
                    height: '40px',
                    borderRadius: '9999px',
                    background: `var(--mobile-${isOverdue(task) ? 'red' : getStatusColor(task.status)}-500)`
                  }} />
                  <div>
                    <h4 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--mobile-gray-900)' }}>{task.title}</h4>
                    <p style={{ fontSize: '10px', fontWeight: 700, color: 'var(--mobile-gray-400)', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: '4px' }}>
                      Project: {task.project?.name || 'Unassigned'}
                    </p>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                  <span className={`mobile-badge mobile-badge-${isOverdue(task) ? 'red' : getStatusColor(task.status)}`}>
                    {isOverdue(task) ? 'Overdue' : task.status?.replace('-', ' ')}
                  </span>
                  <span style={{ fontSize: '10px', fontWeight: 900, color: 'var(--mobile-gray-300)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                    {formatDueDate(task.dueDate)}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="mobile-empty">
              <div className="mobile-empty-icon">
                <span className="material-icons-outlined">assignment</span>
              </div>
              <h4 className="mobile-empty-title">No tasks found</h4>
              <p className="mobile-empty-text">
                {searchQuery || selectedProject !== 'all' || selectedStatus !== 'all' 
                  ? 'Try adjusting your filters' 
                  : 'You have no tasks assigned yet'}
              </p>
            </div>
          )}
        </div>
      </div>
    </MobileLayout>
  );
}
