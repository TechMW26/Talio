'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  FaPhoneAlt, FaTimes, FaUser, FaUsers, FaSearch, 
  FaPaperPlane, FaVolumeUp, FaBuilding, FaExclamationTriangle,
  FaMicrophone, FaCheck, FaChevronDown
} from 'react-icons/fa';
import { useTheme } from '@/contexts/ThemeContext';
import toast from 'react-hot-toast';

// Priority badge colors
const priorityColors = {
  low: 'bg-gray-100 text-gray-800 border-gray-300',
  medium: 'bg-blue-100 text-blue-800 border-blue-300',
  high: 'bg-orange-100 text-orange-800 border-orange-300',
  urgent: 'bg-red-100 text-red-800 border-red-300'
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

  if (!canSendAlerts) return null;

  return (
    <>
      {/* Call Alert Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 text-white rounded-lg shadow-lg hover:shadow-xl transition-all duration-200 font-medium"
        title="Send Call Alert"
      >
        <FaPhoneAlt className="text-lg animate-pulse" />
        <span className="hidden sm:inline">Call / Alert</span>
      </button>

      {/* Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b dark:border-gray-700 bg-gradient-to-r from-red-500 to-orange-500">
              <div className="flex items-center gap-3 text-white">
                <FaPhoneAlt className="text-xl" />
                <h2 className="text-xl font-bold">
                  {step === 1 ? 'Select Recipients' : 'Compose Alert'}
                </h2>
              </div>
              <button
                onClick={handleClose}
                className="p-2 hover:bg-white/20 rounded-full transition-colors text-white"
              >
                <FaTimes />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 overflow-y-auto max-h-[60vh]">
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
                        className="w-full pl-10 pr-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none"
                      />
                    </div>
                    
                    {departments.length > 1 && (
                      <select
                        value={selectedDepartment}
                        onChange={(e) => setSelectedDepartment(e.target.value)}
                        className="px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none"
                      >
                        <option value="all">All Departments</option>
                        {departments.map(dept => (
                          <option key={dept._id} value={dept._id}>{dept.name}</option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* Selection Actions */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {selectedRecipients.length} of {filteredRecipients.length} selected
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={selectAll}
                        className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
                      >
                        Select All
                      </button>
                      <span className="text-gray-400">|</span>
                      <button
                        onClick={clearSelection}
                        className="text-sm text-gray-600 hover:text-gray-700 dark:text-gray-400"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  {/* Recipients List */}
                  <div className="border rounded-lg dark:border-gray-700 max-h-64 overflow-y-auto">
                    {loading ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div>
                      </div>
                    ) : filteredRecipients.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 text-gray-500">
                        <FaUsers className="text-3xl mb-2" />
                        <p>No recipients found</p>
                      </div>
                    ) : (
                      filteredRecipients.map(recipient => {
                        const isSelected = selectedRecipients.some(r => r.userId === recipient.userId);
                        return (
                          <div
                            key={recipient.userId}
                            onClick={() => toggleRecipient(recipient)}
                            className={`flex items-center gap-3 p-3 cursor-pointer border-b last:border-b-0 dark:border-gray-700 transition-colors ${
                              isSelected ? 'bg-orange-50 dark:bg-orange-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                            }`}
                          >
                            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                              isSelected ? 'bg-orange-500 border-orange-500' : 'border-gray-300 dark:border-gray-600'
                            }`}>
                              {isSelected && <FaCheck className="text-white text-xs" />}
                            </div>
                            
                            <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center overflow-hidden">
                              {recipient.profilePicture ? (
                                <img src={recipient.profilePicture} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <FaUser className="text-gray-400" />
                              )}
                            </div>
                            
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-gray-900 dark:text-white truncate">
                                {recipient.name}
                              </p>
                              <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
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
                    <div className="flex flex-wrap gap-2">
                      {selectedRecipients.slice(0, 5).map(r => (
                        <span
                          key={r.userId}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-200 rounded-full text-sm"
                        >
                          {r.name}
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleRecipient(r); }}
                            className="hover:text-orange-600"
                          >
                            <FaTimes className="text-xs" />
                          </button>
                        </span>
                      ))}
                      {selectedRecipients.length > 5 && (
                        <span className="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded-full text-sm">
                          +{selectedRecipients.length - 5} more
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                /* Step 2: Compose Message */
                <div className="space-y-4">
                  {/* Recipients Summary */}
                  <div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                    <FaUsers className="text-orange-500" />
                    <span className="text-gray-700 dark:text-gray-300">
                      Sending to <strong>{selectedRecipients.length}</strong> recipient(s)
                    </span>
                  </div>

                  {/* Template Selection */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Quick Templates
                    </label>
                    <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto">
                      {templates.slice(0, 6).map(template => (
                        <button
                          key={template.id}
                          onClick={() => handleTemplateSelect(template)}
                          className={`p-2 text-left text-sm border rounded-lg transition-all ${
                            selectedTemplate?.id === template.id
                              ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20'
                              : 'border-gray-200 dark:border-gray-600 hover:border-orange-300'
                          }`}
                        >
                          <p className="font-medium text-gray-900 dark:text-white truncate">{template.title}</p>
                          <span className={`inline-block px-1.5 py-0.5 text-xs rounded ${priorityColors[template.priority]}`}>
                            {template.priority}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Custom Message */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Message <span className="text-gray-400">(supports placeholders)</span>
                    </label>
                    <textarea
                      value={customMessage}
                      onChange={(e) => setCustomMessage(e.target.value)}
                      placeholder="Enter your message... Use {senderName}, {receiverName}, {senderRole}, {receiverDepartment} as placeholders"
                      rows={4}
                      className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none resize-none"
                    />
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Available: {'{senderName}'}, {'{receiverName}'}, {'{senderRole}'}, {'{receiverDepartment}'}, {'{time}'}, {'{date}'}
                    </p>
                  </div>

                  {/* Priority & Voice Options */}
                  <div className="flex flex-col sm:flex-row gap-4">
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Priority
                      </label>
                      <select
                        value={priority}
                        onChange={(e) => setPriority(e.target.value)}
                        className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none"
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="urgent">Urgent</option>
                      </select>
                    </div>

                    <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Voice Alert
                      </label>
                      <button
                        onClick={() => setGenerateVoice(!generateVoice)}
                        className={`w-full flex items-center justify-center gap-2 px-4 py-2 border rounded-lg transition-colors ${
                          generateVoice
                            ? 'border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
                            : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400'
                        }`}
                      >
                        <FaMicrophone />
                        {generateVoice ? 'Voice Enabled' : 'Voice Disabled'}
                      </button>
                    </div>
                  </div>

                  {/* Preview */}
                  {customMessage && (
                    <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                      <p className="text-sm text-blue-800 dark:text-blue-200 font-medium mb-1">Preview (for first recipient):</p>
                      <p className="text-sm text-blue-700 dark:text-blue-300">
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
            <div className="flex items-center justify-between px-6 py-4 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
              {step === 1 ? (
                <>
                  <button
                    onClick={handleClose}
                    className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => setStep(2)}
                    disabled={selectedRecipients.length === 0}
                    className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 disabled:from-gray-400 disabled:to-gray-400 text-white rounded-lg font-medium transition-all disabled:cursor-not-allowed"
                  >
                    Next
                    <FaChevronDown className="rotate-[-90deg]" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setStep(1)}
                    className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                  >
                    Back
                  </button>
                  <button
                    onClick={sendAlert}
                    disabled={sending || !customMessage.trim()}
                    className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 disabled:from-gray-400 disabled:to-gray-400 text-white rounded-lg font-medium transition-all disabled:cursor-not-allowed"
                  >
                    {sending ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
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
