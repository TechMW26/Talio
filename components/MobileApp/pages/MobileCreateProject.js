'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '../components/MobileLayout';
import '@/components/MobileApp/styles/mobile.css';

/**
 * Mobile Create Project Page
 * Project creation form optimized for mobile
 */
export default function MobileCreateProject({ 
  user, 
  employees = [],
  departments = [],
  onSubmit
}) {
  const router = useRouter();
  
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    startDate: '',
    endDate: '',
    priority: 'medium',
    status: 'planning',
    department: '',
    teamMembers: [],
    budget: '',
    tags: []
  });
  
  const [currentStep, setCurrentStep] = useState(1);
  const [tagInput, setTagInput] = useState('');
  const [showMemberPicker, setShowMemberPicker] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');

  // Priority options
  const priorities = [
    { id: 'low', label: 'Low', icon: 'arrow_downward', color: 'gray' },
    { id: 'medium', label: 'Medium', icon: 'remove', color: 'blue' },
    { id: 'high', label: 'High', icon: 'arrow_upward', color: 'orange' },
    { id: 'urgent', label: 'Urgent', icon: 'priority_high', color: 'red' }
  ];

  // Status options
  const statuses = [
    { id: 'planning', label: 'Planning', color: 'gray' },
    { id: 'in-progress', label: 'In Progress', color: 'blue' },
    { id: 'on-hold', label: 'On Hold', color: 'orange' },
    { id: 'completed', label: 'Completed', color: 'green' }
  ];

  // Filter employees for search
  const filteredEmployees = employees.filter(emp => 
    !formData.teamMembers.includes(emp._id) &&
    ((emp.name || emp.firstName)?.toLowerCase().includes(memberSearch.toLowerCase()) ||
     emp.email?.toLowerCase().includes(memberSearch.toLowerCase()))
  );

  // Add tag
  const addTag = () => {
    if (tagInput.trim() && !formData.tags.includes(tagInput.trim())) {
      setFormData(prev => ({ ...prev, tags: [...prev.tags, tagInput.trim()] }));
      setTagInput('');
    }
  };

  // Remove tag
  const removeTag = (tag) => {
    setFormData(prev => ({ ...prev, tags: prev.tags.filter(t => t !== tag) }));
  };

  // Add team member
  const addTeamMember = (empId) => {
    setFormData(prev => ({ ...prev, teamMembers: [...prev.teamMembers, empId] }));
    setShowMemberPicker(false);
    setMemberSearch('');
  };

  // Remove team member
  const removeTeamMember = (empId) => {
    setFormData(prev => ({ ...prev, teamMembers: prev.teamMembers.filter(id => id !== empId) }));
  };

  // Get employee by ID
  const getEmployee = (id) => employees.find(e => e._id === id);

  // Validate step
  const isStepValid = () => {
    if (currentStep === 1) {
      return formData.name.trim().length > 0;
    }
    if (currentStep === 2) {
      return formData.startDate && formData.endDate;
    }
    return true;
  };

  // Handle submit
  const handleSubmit = () => {
    if (onSubmit) {
      onSubmit(formData);
    } else {
      console.log('Creating project:', formData);
      router.push('/dashboard/projects');
    }
  };

  // Step 1: Basic Info
  const renderStep1 = () => (
    <>
      {/* Project Name */}
      <div className="mobile-mb-6">
        <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--mobile-gray-500)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', display: 'block' }}>
          Project Name *
        </label>
        <input
          type="text"
          placeholder="Enter project name"
          value={formData.name}
          onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
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

      {/* Description */}
      <div className="mobile-mb-6">
        <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--mobile-gray-500)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', display: 'block' }}>
          Description
        </label>
        <textarea
          placeholder="Describe the project..."
          value={formData.description}
          onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
          rows={4}
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

      {/* Department */}
      {departments.length > 0 && (
        <div className="mobile-mb-6">
          <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--mobile-gray-500)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', display: 'block' }}>
            Department
          </label>
          <select
            value={formData.department}
            onChange={e => setFormData(prev => ({ ...prev, department: e.target.value }))}
            style={{
              width: '100%',
              padding: '16px 20px',
              borderRadius: '16px',
              border: '2px solid var(--mobile-gray-100)',
              fontSize: '16px',
              fontWeight: 500,
              outline: 'none',
              background: 'var(--mobile-gray-50)',
              cursor: 'pointer'
            }}
          >
            <option value="">Select department</option>
            {departments.map(dept => (
              <option key={dept._id} value={dept._id}>{dept.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Priority */}
      <div className="mobile-mb-6">
        <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--mobile-gray-500)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px', display: 'block' }}>
          Priority
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
          {priorities.map(p => (
            <button
              key={p.id}
              onClick={() => setFormData(prev => ({ ...prev, priority: p.id }))}
              style={{
                padding: '14px 8px',
                borderRadius: '14px',
                border: `2px solid ${formData.priority === p.id ? `var(--mobile-${p.color}-500)` : 'var(--mobile-gray-100)'}`,
                background: formData.priority === p.id ? `var(--mobile-${p.color}-50)` : 'var(--mobile-gray-50)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              <span 
                className="material-icons-round" 
                style={{ 
                  fontSize: '20px', 
                  color: formData.priority === p.id ? `var(--mobile-${p.color}-500)` : 'var(--mobile-gray-400)' 
                }}
              >
                {p.icon}
              </span>
              <span style={{ 
                fontSize: '10px', 
                fontWeight: 600, 
                color: formData.priority === p.id ? `var(--mobile-${p.color}-600)` : 'var(--mobile-gray-500)' 
              }}>
                {p.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  );

  // Step 2: Timeline
  const renderStep2 = () => (
    <>
      {/* Start Date */}
      <div className="mobile-mb-6">
        <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--mobile-gray-500)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', display: 'block' }}>
          Start Date *
        </label>
        <input
          type="date"
          value={formData.startDate}
          onChange={e => setFormData(prev => ({ ...prev, startDate: e.target.value }))}
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

      {/* End Date */}
      <div className="mobile-mb-6">
        <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--mobile-gray-500)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', display: 'block' }}>
          End Date *
        </label>
        <input
          type="date"
          value={formData.endDate}
          onChange={e => setFormData(prev => ({ ...prev, endDate: e.target.value }))}
          min={formData.startDate}
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

      {/* Budget */}
      <div className="mobile-mb-6">
        <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--mobile-gray-500)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', display: 'block' }}>
          Budget (Optional)
        </label>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: '20px', top: '50%', transform: 'translateY(-50%)', fontSize: '16px', fontWeight: 600, color: 'var(--mobile-gray-400)' }}>₹</span>
          <input
            type="number"
            placeholder="0"
            value={formData.budget}
            onChange={e => setFormData(prev => ({ ...prev, budget: e.target.value }))}
            style={{
              width: '100%',
              padding: '16px 20px 16px 40px',
              borderRadius: '16px',
              border: '2px solid var(--mobile-gray-100)',
              fontSize: '16px',
              fontWeight: 500,
              outline: 'none',
              background: 'var(--mobile-gray-50)'
            }}
          />
        </div>
      </div>

      {/* Status */}
      <div className="mobile-mb-6">
        <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--mobile-gray-500)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px', display: 'block' }}>
          Initial Status
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
          {statuses.map(s => (
            <button
              key={s.id}
              onClick={() => setFormData(prev => ({ ...prev, status: s.id }))}
              style={{
                padding: '14px',
                borderRadius: '14px',
                border: `2px solid ${formData.status === s.id ? `var(--mobile-${s.color}-500)` : 'var(--mobile-gray-100)'}`,
                background: formData.status === s.id ? `var(--mobile-${s.color}-50)` : 'var(--mobile-gray-50)',
                cursor: 'pointer',
                transition: 'all 0.2s',
                textAlign: 'center'
              }}
            >
              <span style={{ 
                fontSize: '13px', 
                fontWeight: 600, 
                color: formData.status === s.id ? `var(--mobile-${s.color}-600)` : 'var(--mobile-gray-500)' 
              }}>
                {s.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  );

  // Step 3: Team & Tags
  const renderStep3 = () => (
    <>
      {/* Team Members */}
      <div className="mobile-mb-6">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--mobile-gray-500)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Team Members
          </label>
          <button 
            onClick={() => setShowMemberPicker(true)}
            style={{ 
              fontSize: '12px', 
              fontWeight: 600, 
              color: 'var(--mobile-primary)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <span className="material-icons-round" style={{ fontSize: '16px' }}>add</span>
            Add
          </button>
        </div>
        
        {/* Selected Members */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {formData.teamMembers.map(memberId => {
            const emp = getEmployee(memberId);
            if (!emp) return null;
            return (
              <div 
                key={memberId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  borderRadius: '12px',
                  background: 'var(--mobile-gray-50)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '10px',
                    background: 'var(--mobile-primary-50)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--mobile-primary)',
                    fontWeight: 700,
                    fontSize: '14px'
                  }}>
                    {(emp.name || emp.firstName || 'U')[0].toUpperCase()}
                  </div>
                  <div>
                    <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--mobile-gray-900)' }}>
                      {emp.name || `${emp.firstName} ${emp.lastName}`}
                    </p>
                    <p style={{ fontSize: '12px', fontWeight: 500, color: 'var(--mobile-gray-400)' }}>
                      {emp.designation || emp.position || 'Employee'}
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => removeTeamMember(memberId)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
                >
                  <span className="material-icons-round" style={{ fontSize: '20px', color: 'var(--mobile-gray-400)' }}>close</span>
                </button>
              </div>
            );
          })}
          
          {formData.teamMembers.length === 0 && (
            <p style={{ fontSize: '14px', fontWeight: 500, color: 'var(--mobile-gray-400)', textAlign: 'center', padding: '20px' }}>
              No team members added yet
            </p>
          )}
        </div>
      </div>

      {/* Tags */}
      <div className="mobile-mb-6">
        <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--mobile-gray-500)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', display: 'block' }}>
          Tags
        </label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            placeholder="Add a tag"
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyPress={e => e.key === 'Enter' && addTag()}
            style={{
              flex: 1,
              padding: '14px 16px',
              borderRadius: '12px',
              border: '2px solid var(--mobile-gray-100)',
              fontSize: '14px',
              fontWeight: 500,
              outline: 'none',
              background: 'var(--mobile-gray-50)'
            }}
          />
          <button 
            onClick={addTag}
            style={{
              padding: '14px 20px',
              borderRadius: '12px',
              background: 'var(--mobile-primary)',
              color: 'white',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600
            }}
          >
            Add
          </button>
        </div>
        
        {/* Tag List */}
        {formData.tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
            {formData.tags.map(tag => (
              <span 
                key={tag}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 12px',
                  borderRadius: '10px',
                  background: 'var(--mobile-primary-50)',
                  color: 'var(--mobile-primary)',
                  fontSize: '13px',
                  fontWeight: 600
                }}
              >
                {tag}
                <button 
                  onClick={() => removeTag(tag)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', display: 'flex' }}
                >
                  <span className="material-icons-round" style={{ fontSize: '16px' }}>close</span>
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  );

  // Member Picker Modal
  const renderMemberPicker = () => (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.5)',
      zIndex: 1000,
      display: 'flex',
      alignItems: 'flex-end'
    }}>
      <div style={{
        background: 'white',
        width: '100%',
        borderRadius: '24px 24px 0 0',
        padding: '24px',
        maxHeight: '70vh',
        overflow: 'auto',
        animation: 'slideUp 0.3s ease'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--mobile-gray-900)' }}>Add Team Member</h3>
          <button 
            onClick={() => { setShowMemberPicker(false); setMemberSearch(''); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}
          >
            <span className="material-icons-round" style={{ fontSize: '24px', color: 'var(--mobile-gray-400)' }}>close</span>
          </button>
        </div>
        
        {/* Search */}
        <div style={{ position: 'relative', marginBottom: '16px' }}>
          <span className="material-icons-round" style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', fontSize: '20px', color: 'var(--mobile-gray-400)' }}>search</span>
          <input
            type="text"
            placeholder="Search employees..."
            value={memberSearch}
            onChange={e => setMemberSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '14px 16px 14px 48px',
              borderRadius: '14px',
              border: '2px solid var(--mobile-gray-100)',
              fontSize: '14px',
              fontWeight: 500,
              outline: 'none',
              background: 'var(--mobile-gray-50)'
            }}
          />
        </div>
        
        {/* Employee List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filteredEmployees.slice(0, 10).map(emp => (
            <div 
              key={emp._id}
              onClick={() => addTeamMember(emp._id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px 16px',
                borderRadius: '12px',
                cursor: 'pointer',
                transition: 'background 0.2s'
              }}
            >
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '12px',
                background: 'var(--mobile-primary-50)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--mobile-primary)',
                fontWeight: 700,
                fontSize: '16px'
              }}>
                {(emp.name || emp.firstName || 'U')[0].toUpperCase()}
              </div>
              <div>
                <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--mobile-gray-900)' }}>
                  {emp.name || `${emp.firstName} ${emp.lastName}`}
                </p>
                <p style={{ fontSize: '12px', fontWeight: 500, color: 'var(--mobile-gray-400)' }}>
                  {emp.designation || emp.position || emp.email}
                </p>
              </div>
            </div>
          ))}
          
          {filteredEmployees.length === 0 && (
            <p style={{ fontSize: '14px', fontWeight: 500, color: 'var(--mobile-gray-400)', textAlign: 'center', padding: '20px' }}>
              No employees found
            </p>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <MobileLayout title="Create Project" user={user} showBack onBack={() => router.back()}>
      <div className="mobile-page">
        {/* Progress Steps */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
          {[1, 2, 3].map(step => (
            <div 
              key={step}
              style={{
                flex: 1,
                height: '4px',
                borderRadius: '2px',
                background: step <= currentStep ? 'var(--mobile-primary)' : 'var(--mobile-gray-200)',
                transition: 'background 0.3s'
              }}
            />
          ))}
        </div>
        
        {/* Step Title */}
        <div className="mobile-mb-6">
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--mobile-gray-900)' }}>
            {currentStep === 1 && 'Basic Information'}
            {currentStep === 2 && 'Timeline & Budget'}
            {currentStep === 3 && 'Team & Tags'}
          </h2>
          <p style={{ fontSize: '14px', fontWeight: 500, color: 'var(--mobile-gray-400)', marginTop: '4px' }}>
            Step {currentStep} of 3
          </p>
        </div>

        {/* Step Content */}
        {currentStep === 1 && renderStep1()}
        {currentStep === 2 && renderStep2()}
        {currentStep === 3 && renderStep3()}

        {/* Navigation Buttons */}
        <div style={{ display: 'flex', gap: '12px', marginTop: '32px' }}>
          {currentStep > 1 && (
            <button 
              className="mobile-btn mobile-btn-outline mobile-btn-rounded"
              onClick={() => setCurrentStep(prev => prev - 1)}
              style={{ flex: 1, padding: '16px' }}
            >
              Back
            </button>
          )}
          
          {currentStep < 3 ? (
            <button 
              className="mobile-btn mobile-btn-primary mobile-btn-rounded"
              onClick={() => setCurrentStep(prev => prev + 1)}
              disabled={!isStepValid()}
              style={{ flex: currentStep === 1 ? 1 : 2, padding: '16px', opacity: !isStepValid() ? 0.5 : 1 }}
            >
              Next
            </button>
          ) : (
            <button 
              className="mobile-btn mobile-btn-primary mobile-btn-rounded"
              onClick={handleSubmit}
              style={{ flex: 2, padding: '16px' }}
            >
              <span className="material-icons-round" style={{ fontSize: '20px' }}>add</span>
              Create Project
            </button>
          )}
        </div>
      </div>
      
      {/* Member Picker Modal */}
      {showMemberPicker && renderMemberPicker()}
    </MobileLayout>
  );
}
