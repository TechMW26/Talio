'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  FaPhoneAlt, FaTimes, FaUser, FaUsers, FaSearch, 
  FaPaperPlane, FaVolumeUp, FaBuilding, FaExclamationTriangle,
  FaMicrophone, FaCheck, FaChevronRight
} from 'react-icons/fa';
import { useTheme } from '@/contexts/ThemeContext';
import toast from 'react-hot-toast';

// Priority badge colors matching project's theme
const priorityColors = {
  low: 'bg-gray-100 text-gray-700 border border-gray-200',
  medium: 'bg-blue-50 text-blue-700 border border-blue-200',
  high: 'bg-orange-50 text-orange-700 border border-orange-200',
  urgent: 'bg-red-50 text-red-700 border border-red-200'
};

export default function CallAlertButton({ user }) {
  const { theme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState(1); // 1: Select recipients, 2: Compose message
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  
  // Recipients data
  const [recipients, setRecipients] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [selectedRecipients, setSelectedRecipients] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('all');
  
  // Message data
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [customMessage, setCustomMessage] = useState('');
  const [priority, setPriority] = useState('high');
  const [generateVoice, setGenerateVoice] = useState(true);
  
  // Check if user can send alerts
  const canSendAlerts = ['admin', 'god_admin', 'department_head'].includes(user?.role);

  // Fetch recipients
  const fetchRecipients = useCallback(async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/call-alert/recipients', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      
      if (data.success) {
        setRecipients(data.data.recipients);
        setDepartments(data.data.departments);
      }
    } catch (error) {
      console.error('Error fetching recipients:', error);
      toast.error('Failed to load recipients');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch templates
  const fetchTemplates = useCallback(async () => {
    try {
      const response = await fetch('/api/call-alert/templates');
      const data = await response.json();
      
      if (data.success) {
        setTemplates(data.data.templates);
      }
    } catch (error) {
      console.error('Error fetching templates:', error);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchRecipients();
      fetchTemplates();
    }
  }, [isOpen, fetchRecipients, fetchTemplates]);

  // Filter recipients
  const filteredRecipients = recipients.filter(r => {
    const matchesSearch = searchQuery === '' || 
      r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.employeeCode.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesDepartment = selectedDepartment === 'all' || 
      r.departmentId?.toString() === selectedDepartment;
    
    return matchesSearch && matchesDepartment;
  });

  // Toggle recipient selection
  const toggleRecipient = (recipient) => {
    setSelectedRecipients(prev => {
      const isSelected = prev.some(r => r.userId === recipient.userId);
      if (isSelected) {
        return prev.filter(r => r.userId !== recipient.userId);
      }
      return [...prev, recipient];
    });
  };

  // Select all filtered recipients
  const selectAll = () => {
    setSelectedRecipients(filteredRecipients);
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedRecipients([]);
  };

  // Handle template selection
  const handleTemplateSelect = (template) => {
    setSelectedTemplate(template);
    setCustomMessage(template.template);
    setPriority(template.priority || 'high');
  };

  // Send alert
  const sendAlert = async () => {
    if (selectedRecipients.length === 0) {
      toast.error('Please select at least one recipient');
      return;
    }

    if (!customMessage.trim()) {
      toast.error('Please enter a message');
      return;
    }

    try {
      setSending(true);
      const token = localStorage.getItem('token');
      
      const response = await fetch('/api/call-alert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          targetUserIds: selectedRecipients.map(r => r.userId),
          messageTemplate: customMessage,
          prebuiltMessageId: selectedTemplate?.id,
          priority,
          generateVoice,
          triggerPlatform: 'web',
          triggerLocation: 'dashboard'
        })
      });

      const data = await response.json();

      if (data.success) {
        toast.success(`Alert sent to ${data.data.recipientCount} recipient(s)`);
        handleClose();
      } else {
        toast.error(data.message || 'Failed to send alert');
      }
    } catch (error) {
      console.error('Error sending alert:', error);
      toast.error('Failed to send alert');
    } finally {
      setSending(false);
    }
  };

  // Handle close
  const handleClose = () => {
    setIsOpen(false);
    setStep(1);
    setSelectedRecipients([]);
    setCustomMessage('');
    setSelectedTemplate(null);
    setSearchQuery('');
    setSelectedDepartment('all');
    setPriority('high');
    setGenerateVoice(true);
  };

  // Handle backdrop click
  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  if (!canSendAlerts) return null;

  return (
    <>
      {/* Call Alert Button - Styled to match project theme */}
      <button
        onClick={() => setIsOpen(true)}
        className="modal-btn modal-btn-primary flex items-center gap-2"
        style={{ 
          background: 'linear-gradient(135deg, var(--color-primary-500) 0%, var(--color-primary-600) 100%)',
        }}
        title="Send Call Alert"
      >
        <FaPhoneAlt className="text-sm" />
        <span className="hidden sm:inline">Call / Alert</span>
      </button>

      {/* Modal using project's unified modal system */}
      {isOpen && (
        <div className="modal-overlay" onClick={handleBackdropClick}>
          <div className="modal-backdrop" />
          
          <div className="modal-container modal-2xl">
            {/* Header */}
            <div className="modal-header" style={{ 
              background: 'linear-gradient(135deg, var(--color-primary-500) 0%, var(--color-primary-600) 100%)',
              borderBottom: 'none'
            }}>
              <div className="flex items-center gap-3 text-white">
                <div className="p-2 bg-white/20 rounded-lg">
                  <FaPhoneAlt className="text-lg" />
                </div>
                <h3 className="modal-title text-white">
                  {step === 1 ? 'Select Recipients' : 'Compose Alert'}
                </h3>
              </div>
              <button
                onClick={handleClose}
                className="modal-close-btn text-white hover:bg-white/20"
              >
                <FaTimes className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="modal-body">
              {step === 1 ? (
                /* Step 1: Select Recipients */
                <div className="space-y-4">
                  {/* Search and Filter */}
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                      <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search by name or employee code..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="modal-input pl-10"
                      />
                    </div>
                    
                    {departments.length > 1 && (
                      <select
                        value={selectedDepartment}
                        onChange={(e) => setSelectedDepartment(e.target.value)}
                        className="modal-select"
                        style={{ width: 'auto', minWidth: '180px' }}
                      >
                        <option value="all">All Departments</option>
                        {departments.map(dept => (
                          <option key={dept._id} value={dept._id}>{dept.name}</option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* Selection Actions */}
                  <div className="flex items-center justify-between py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-600">
                      <strong>{selectedRecipients.length}</strong> of <strong>{filteredRecipients.length}</strong> selected
                    </span>
                    <div className="flex gap-3">
                      <button
                        onClick={selectAll}
                        className="text-sm font-medium hover:underline"
                        style={{ color: 'var(--color-primary-500)' }}
                      >
                        Select All
                      </button>
                      <button
                        onClick={clearSelection}
                        className="text-sm text-gray-500 hover:text-gray-700 font-medium hover:underline"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  {/* Recipients List */}
                  <div className="border border-gray-200 rounded-lg max-h-64 overflow-y-auto">
                    {loading ? (
                      <div className="flex items-center justify-center py-12">
                        <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200" style={{ borderTopColor: 'var(--color-primary-500)' }}></div>
                      </div>
                    ) : filteredRecipients.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                        <FaUsers className="text-4xl mb-3" />
                        <p className="font-medium">No recipients found</p>
                      </div>
                    ) : (
                      filteredRecipients.map(recipient => {
                        const isSelected = selectedRecipients.some(r => r.userId === recipient.userId);
                        return (
                          <div
                            key={recipient.userId}
                            onClick={() => toggleRecipient(recipient)}
                            className={`flex items-center gap-3 p-3 cursor-pointer border-b border-gray-100 last:border-b-0 transition-colors ${
                              isSelected ? 'bg-primary-50' : 'hover:bg-gray-50'
                            }`}
                            style={isSelected ? { backgroundColor: 'var(--color-primary-50, #eff6ff)' } : {}}
                          >
                            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                              isSelected ? 'border-primary-500 bg-primary-500' : 'border-gray-300'
                            }`}
                            style={isSelected ? { borderColor: 'var(--color-primary-500)', backgroundColor: 'var(--color-primary-500)' } : {}}>
                              {isSelected && <FaCheck className="text-white text-xs" />}
                            </div>
                            
                            <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center overflow-hidden">
                              {recipient.profilePicture ? (
                                <img src={recipient.profilePicture} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <FaUser className="text-gray-400" />
                              )}
                            </div>
                            
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-gray-900 truncate">
                                {recipient.name}
                              </p>
                              <p className="text-sm text-gray-500 truncate">
                                {recipient.employeeCode} • {recipient.department}
                              </p>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Selected Recipients Tags */}
                  {selectedRecipients.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-2">
                      {selectedRecipients.slice(0, 5).map(r => (
                        <span
                          key={r.userId}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium"
                          style={{ 
                            backgroundColor: 'var(--color-primary-50, #eff6ff)',
                            color: 'var(--color-primary-700, #1d4ed8)'
                          }}
                        >
                          {r.name}
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleRecipient(r); }}
                            className="hover:opacity-70 transition-opacity"
                          >
                            <FaTimes className="text-xs" />
                          </button>
                        </span>
                      ))}
                      {selectedRecipients.length > 5 && (
                        <span className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-full text-sm font-medium">
                          +{selectedRecipients.length - 5} more
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                /* Step 2: Compose Message */
                <div className="space-y-5">
                  {/* Recipients Summary */}
                  <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-100">
                    <div className="p-2 rounded-lg" style={{ backgroundColor: 'var(--color-primary-100, #dbeafe)' }}>
                      <FaUsers style={{ color: 'var(--color-primary-600, #2563eb)' }} />
                    </div>
                    <span className="text-gray-700">
                      Sending to <strong className="text-gray-900">{selectedRecipients.length}</strong> recipient(s)
                    </span>
                  </div>

                  {/* Template Selection */}
                  <div>
                    <label className="modal-label">Quick Templates</label>
                    <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto">
                      {templates.slice(0, 6).map(template => (
                        <button
                          key={template.id}
                          onClick={() => handleTemplateSelect(template)}
                          className={`p-3 text-left border rounded-lg transition-all ${
                            selectedTemplate?.id === template.id
                              ? 'border-primary-500 bg-primary-50 ring-2 ring-primary-200'
                              : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                          }`}
                          style={selectedTemplate?.id === template.id ? {
                            borderColor: 'var(--color-primary-500)',
                            backgroundColor: 'var(--color-primary-50, #eff6ff)'
                          } : {}}
                        >
                          <p className="font-medium text-gray-900 truncate text-sm">{template.title}</p>
                          <span className={`inline-block mt-1 px-2 py-0.5 text-xs rounded-full font-medium ${priorityColors[template.priority]}`}>
                            {template.priority}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Custom Message */}
                  <div>
                    <label className="modal-label">
                      Message <span className="text-gray-400 font-normal">(supports placeholders)</span>
                    </label>
                    <textarea
                      value={customMessage}
                      onChange={(e) => setCustomMessage(e.target.value)}
                      placeholder="Enter your message... Use {senderName}, {receiverName}, {senderRole}, {receiverDepartment} as placeholders"
                      rows={4}
                      className="modal-textarea"
                    />
                    <p className="mt-2 text-xs text-gray-500">
                      Available placeholders: <code className="px-1 py-0.5 bg-gray-100 rounded">{'{senderName}'}</code>, <code className="px-1 py-0.5 bg-gray-100 rounded">{'{receiverName}'}</code>, <code className="px-1 py-0.5 bg-gray-100 rounded">{'{time}'}</code>, <code className="px-1 py-0.5 bg-gray-100 rounded">{'{date}'}</code>
                    </p>
                  </div>

                  {/* Priority & Voice Options */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="modal-label">Priority</label>
                      <select
                        value={priority}
                        onChange={(e) => setPriority(e.target.value)}
                        className="modal-select"
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="urgent">Urgent</option>
                      </select>
                    </div>

                    <div>
                      <label className="modal-label">Voice Alert (AI)</label>
                      <button
                        onClick={() => setGenerateVoice(!generateVoice)}
                        className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 border rounded-lg transition-all font-medium ${
                          generateVoice
                            ? 'border-green-500 bg-green-50 text-green-700'
                            : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <FaMicrophone />
                        {generateVoice ? 'Voice Enabled' : 'Voice Disabled'}
                      </button>
                    </div>
                  </div>

                  {/* Preview */}
                  {customMessage && (
                    <div className="p-4 rounded-lg border" style={{ 
                      backgroundColor: 'var(--color-primary-50, #eff6ff)',
                      borderColor: 'var(--color-primary-200, #bfdbfe)'
                    }}>
                      <p className="text-sm font-medium mb-2" style={{ color: 'var(--color-primary-700, #1d4ed8)' }}>
                        Message Preview:
                      </p>
                      <p className="text-sm" style={{ color: 'var(--color-primary-600, #2563eb)' }}>
                        {customMessage
                          .replace('{senderName}', `${user?.firstName || 'You'} ${user?.lastName || ''}`.trim())
                          .replace('{senderRole}', user?.role === 'admin' ? 'Administrator' : user?.role === 'department_head' ? 'Department Head' : 'Manager')
                          .replace('{receiverName}', selectedRecipients[0]?.name || 'Employee')
                          .replace('{receiverDepartment}', selectedRecipients[0]?.department || 'Department')
                          .replace('{time}', new Date().toLocaleTimeString())
                          .replace('{date}', new Date().toLocaleDateString())
                        }
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="modal-footer">
              {step === 1 ? (
                <>
                  <button
                    onClick={handleClose}
                    className="modal-btn modal-btn-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => setStep(2)}
                    disabled={selectedRecipients.length === 0}
                    className="modal-btn modal-btn-primary flex items-center gap-2"
                    style={selectedRecipients.length > 0 ? {
                      background: 'linear-gradient(135deg, var(--color-primary-500) 0%, var(--color-primary-600) 100%)'
                    } : {}}
                  >
                    Next
                    <FaChevronRight className="text-xs" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setStep(1)}
                    className="modal-btn modal-btn-secondary"
                  >
                    Back
                  </button>
                  <button
                    onClick={sendAlert}
                    disabled={sending || !customMessage.trim()}
                    className="modal-btn modal-btn-primary flex items-center gap-2"
                    style={!sending && customMessage.trim() ? {
                      background: 'linear-gradient(135deg, var(--color-primary-500) 0%, var(--color-primary-600) 100%)'
                    } : {}}
                  >
                    {sending ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white"></div>
                        Sending...
                      </>
                    ) : (
                      <>
                        <FaPaperPlane />
                        Send Alert
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
