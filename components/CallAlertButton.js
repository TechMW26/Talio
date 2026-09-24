'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Select, SelectItem } from '@heroui/react';
import Loader from '@/components/ui/Loader';
import { getRoleDisplayLabel } from '@/hooks/useRoles';
import {
  HiOutlineXMark,
  HiOutlinePhone,
  HiOutlineMagnifyingGlass,
  HiOutlineCheck,
  HiOutlineChevronRight,
  HiOutlineChevronDown,
  HiOutlineChevronUp,
  HiOutlineUserGroup,
  HiOutlinePaperAirplane,
  HiOutlineSpeakerWave,
  HiOutlineExclamationTriangle,
  HiOutlineUser,
  HiOutlineBuildingOffice2,
  HiOutlineUsers,
  HiOutlineArrowRight,
  HiOutlineArrowLeft
} from 'react-icons/hi2';
import toast from '@/utils/toast';
import ModalPortal from '@/components/ModalPortal';
import { filterDepartmentGroupEmployees, hasActiveGroupSearch, isDepartmentGroupExpanded } from '@/lib/departmentGroupSearch';

// Priority badge colors matching project's theme
const priorityColors = {
  low: 'bg-default-100 text-default-700',
  medium: 'bg-primary/10 text-primary',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700'
};

export default function CallAlertButton({ user, floating = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState(1); // 1: Select recipients, 2: Compose message
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [canSendAlerts, setCanSendAlerts] = useState(false);
  const [permissionsChecked, setPermissionsChecked] = useState(false);

  // Recipients data
  const [recipients, setRecipients] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [selectedRecipients, setSelectedRecipients] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('all');
  const [expandedDepts, setExpandedDepts] = useState({});

  // Message data
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [customMessage, setCustomMessage] = useState('');
  const [priority, setPriority] = useState('high');
  const [generateVoice, setGenerateVoice] = useState(true);

  // Check permissions on mount - handles both role-based and department head detection
  useEffect(() => {
    const checkPermissions = async () => {
      // First, try to get updated user from localStorage (in case it was updated after login)
      let currentUser = user;
      try {
        const storedUser = localStorage.getItem('user');
        if (storedUser) {
          const parsedUser = JSON.parse(storedUser);
          // Use localStorage data if available and has isDepartmentHead field
          if (parsedUser && typeof parsedUser.isDepartmentHead !== 'undefined') {
            currentUser = parsedUser;
          }
        }
      } catch (e) {
        console.error('Error parsing user from localStorage:', e);
      }

      // Check if user has isDepartmentHead flag from user meta (set during login)
      if (currentUser?.isDepartmentHead === true) {
        console.log('[CallAlertButton] User is department head (from user meta)');
        setCanSendAlerts(true);
        setPermissionsChecked(true);
        return;
      }

      // Check role directly from user object (Admin, God Admin, HR, or department_head role)
      // Note: Manager role does NOT get access unless they are a department head
      const allowedRoles = ['admin', 'department_head', 'hr'];
      if (allowedRoles.includes(currentUser?.role)) {
        console.log('[CallAlertButton] User has allowed role:', currentUser?.role);
        setCanSendAlerts(true);
        setPermissionsChecked(true);
        return;
      }

      // If role is not in allowed list and isDepartmentHead is not set, 
      // check via API (fallback for users who haven't re-logged in after sync)
      console.log('[CallAlertButton] Checking permissions via API...');
      try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/call-alert/recipients', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        console.log('[CallAlertButton] API response:', data.success, data.data?.permissions);

        if (data.success && data.data?.permissions) {
          // If API returns success, user has permission
          const hasAccess = data.data.permissions.isAdmin || data.data.permissions.isDepartmentHead;
          console.log('[CallAlertButton] API permission check:', hasAccess);
          setCanSendAlerts(hasAccess);

          // Update localStorage with department head status if detected
          if (data.data.permissions.isDepartmentHead && currentUser) {
            try {
              const updatedUser = { ...currentUser, isDepartmentHead: true };
              localStorage.setItem('user', JSON.stringify(updatedUser));
            } catch (e) {
              console.error('Error updating localStorage:', e);
            }
          }
        }
      } catch (error) {
        console.error('Error checking call alert permissions:', error);
      }
      setPermissionsChecked(true);
    };

    checkPermissions();
  }, [user?.role, user?.isDepartmentHead]);

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

        // If user is a department head (not admin), default to their department
        const permissions = data.data.permissions;
        if (permissions?.isDepartmentHead && !permissions?.isAdmin && permissions?.headOfDepartments?.length > 0) {
          // Set the first department they head as default filter
          const defaultDeptId = permissions.headOfDepartments[0];
          setSelectedDepartment(defaultDeptId);
          // Also expand that department by default
          setExpandedDepts(prev => ({ ...prev, [defaultDeptId]: true }));
          console.log('[CallAlertButton] Defaulting to department head\'s department:', defaultDeptId);
        }
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

  // Group recipients by department
  const groupedRecipients = recipients.reduce((groups, recipient) => {
    const deptName = recipient.department || 'No Department';
    const deptId = recipient.departmentId?.toString() || 'no-department';
    if (!groups[deptId]) {
      groups[deptId] = {
        department: { _id: deptId, name: deptName },
        employees: []
      };
    }
    groups[deptId].employees.push(recipient);
    return groups;
  }, {});

  const departmentGroups = Object.values(groupedRecipients);

  // Filter by search and department
  const filteredDeptGroups = departmentGroups.map(group => ({
    ...group,
    employees: selectedDepartment !== 'all' && group.department._id !== selectedDepartment
      ? []
      : filterDepartmentGroupEmployees({
        departmentName: group.department?.name,
        employees: group.employees,
        searchQuery,
        matchesEmployee: (employee, query) => [
          employee.name,
          employee.email,
          employee.employeeCode,
          employee.designation,
        ].some(value => String(value || '').toLocaleLowerCase().includes(query)),
      }),
  })).filter(group => group.employees.length > 0);

  // Toggle department expand
  const toggleDepartmentExpand = (deptId) => {
    if (hasActiveGroupSearch(searchQuery)) return;
    setExpandedDepts(prev => ({ ...prev, [deptId]: !prev[deptId] }));
  };

  // Toggle select all in department
  const toggleSelectAllDepartment = (deptId) => {
    const dept = filteredDeptGroups.find(d => d.department._id === deptId);
    if (!dept) return;

    const deptEmployeeIds = dept.employees.map(e => e.userId);
    const allSelected = deptEmployeeIds.every(id => selectedRecipients.some(r => r.userId === id));

    if (allSelected) {
      setSelectedRecipients(prev => prev.filter(r => !deptEmployeeIds.includes(r.userId)));
    } else {
      const newRecipients = dept.employees.filter(e => !selectedRecipients.some(r => r.userId === e.userId));
      setSelectedRecipients(prev => [...prev, ...newRecipients]);
    }
  };

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

  // Don't render until permissions are checked, or if user doesn't have permission
  if (!permissionsChecked || !canSendAlerts) return null;

  // Total employees count
  const totalEmployeesCount = filteredDeptGroups.reduce((sum, g) => sum + g.employees.length, 0);

  const trigger = (
      <button
        onClick={() => setIsOpen(true)}
        aria-label="Call / Alert"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        className={`inline-flex h-10 w-10 sm:w-auto shrink-0 items-center justify-center gap-2 sm:px-4 rounded-full border border-primary/20 bg-primary/10 text-primary text-sm font-semibold hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background transition-colors duration-200 ${floating ? 'fixed z-40' : ''}`}
        style={{
          ...(floating ? {
            bottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))',
            right: 'calc(1.5rem + env(safe-area-inset-right, 0px))',
          } : {}),
        }}
        title="Send Call Alert"
      >
        <HiOutlinePhone className="w-5 h-5" />
        <span className="hidden sm:inline">Call / Alert</span>
      </button>
  );

  return (
    <>
      {/* Escape transformed route ancestors so fixed positioning follows the viewport. */}
      {floating ? (typeof document !== 'undefined' ? createPortal(trigger, document.body) : null) : trigger}

      {/* Modal via Portal */}
      <ModalPortal show={isOpen}>
        <div
          className="modal-overlay"
          onClick={handleBackdropClick}
        >
          {/* Modal Content */}
          <div role="dialog" aria-modal="true" aria-labelledby="call-alert-title" className="relative bg-content1 text-foreground border border-default-200 rounded-[30px] shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden animate-modal-enter" onClick={e => e.stopPropagation()}>
            {/* Header with gradient */}
            <div
              className="px-6 py-5 bg-primary/10 border-b border-primary/15"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div>
                    <h2 id="call-alert-title" className="text-xl font-semibold text-foreground">
                      {step === 1 ? 'Select Recipients' : 'Compose Alert'}
                    </h2>
                    <p className="text-sm text-default-500 mt-0.5">
                      {step === 1 ? 'Choose who will receive this alert' : 'Write your message'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleClose}
                  aria-label="Close call alert"
                  className="p-2 rounded-full text-default-600 hover:bg-primary/10 transition-colors"
                >
                  <HiOutlineXMark className="w-6 h-6 text-blue" />
                </button>
              </div>

              {/* Step Progress Bar */}
              <div className="mt-4 flex items-center gap-2">
                <div className={`h-1.5 flex-1 rounded-full transition-all ${step >= 1 ? 'bg-primary' : 'bg-primary/20'}`} />
                <div className={`h-1.5 flex-1 rounded-full transition-all ${step >= 2 ? 'bg-primary' : 'bg-primary/20'}`} />
              </div>
            </div>

            {/* Body - White background with black text */}
            <div className="p-6 max-h-[60vh] overflow-y-auto bg-content1">
              {step === 1 ? (
                /* Step 1: Select Recipients */
                <div className="space-y-4">
                  {/* Search and Filter */}
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="input-with-icon flex-1">
                      <HiOutlineMagnifyingGlass className="input-icon w-5 h-5" />
                      <input
                        type="text"
                        placeholder="Search by name or employee code..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="input input-search"
                      />
                    </div>

                    {departments.length > 1 && (
                      <Select
                        selectedKeys={[selectedDepartment]}
                        onChange={(e) => setSelectedDepartment(e.target.value)}
                        aria-label="Filter by Department"
                        className="min-w-[180px]"
                        classNames={{ trigger: "bg-content1" }}
                      >
                        <SelectItem key="all">All Departments</SelectItem>
                        {departments.map(dept => (
                          <SelectItem key={dept._id}>{dept.name}</SelectItem>
                        ))}
                      </Select>
                    )}
                  </div>

                  {/* Selection Summary */}
                  <div className="flex items-center justify-between py-2 px-3 bg-default-100 rounded-2xl">
                    <span className="text-sm text-default-500">
                      <span className="font-semibold text-foreground">{selectedRecipients.length}</span> of <span className="font-semibold text-foreground">{totalEmployeesCount}</span> selected
                    </span>
                    {selectedRecipients.length > 0 && (
                      <button
                        onClick={() => setSelectedRecipients([])}
                        className="text-sm font-medium text-red-500 hover:text-red-600 transition-colors"
                      >
                        Clear All
                      </button>
                    )}
                  </div>

                  {/* Department Groups */}
                  <div className="border border-default-300 rounded-2xl max-h-72 overflow-y-auto bg-content1">
                    {loading ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader size="md" />
                      </div>
                    ) : filteredDeptGroups.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-default-500">
                        <HiOutlineUsers className="w-12 h-12 mb-3" />
                        <p className="font-medium">No recipients found</p>
                      </div>
                    ) : (
                      filteredDeptGroups.map(group => {
                        const deptId = group.department._id;
                        const isExpanded = isDepartmentGroupExpanded({
                          searchQuery,
                          expandedDepartments: expandedDepts,
                          departmentId: deptId,
                          defaultExpanded: true,
                        });
                        const deptEmployeeIds = group.employees.map(e => e.userId);
                        const allSelected = deptEmployeeIds.every(id => selectedRecipients.some(r => r.userId === id));
                        const someSelected = deptEmployeeIds.some(id => selectedRecipients.some(r => r.userId === id));

                        return (
                          <div key={deptId} className="border-b border-default-200 last:border-b-0">
                            {/* Department Header */}
                            <div className="flex items-center gap-3 px-4 py-3 bg-default-50 cursor-pointer hover:bg-default-100 transition-colors">
                              <button
                                onClick={() => toggleDepartmentExpand(deptId)}
                                className="p-1"
                              >
                                <HiOutlineChevronDown className={`w-4 h-4 text-default-500 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                              </button>

                              <button
                                onClick={() => toggleSelectAllDepartment(deptId)}
                                className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${allSelected
                                    ? 'border-primary bg-primary'
                                    : someSelected
                                      ? 'border-primary bg-primary/10'
                                      : 'border-default-300'
                                  }`}
                              >
                                {allSelected && <HiOutlineCheck className="w-3 h-3 text-primary-foreground" />}
                                {someSelected && !allSelected && <div className="w-2 h-0.5 bg-primary rounded" />}
                              </button>

                              <div className="flex-1" onClick={() => toggleDepartmentExpand(deptId)}>
                                <span className="font-medium text-foreground">{group.department.name}</span>
                                <span className="ml-2 text-sm text-default-500">({group.employees.length})</span>
                              </div>
                            </div>

                            {/* Department Employees */}
                            {isExpanded && (
                              <div className="divide-y divide-gray-100">
                                {group.employees.map(recipient => {
                                  const isSelected = selectedRecipients.some(r => r.userId === recipient.userId);
                                  return (
                                    <div
                                      key={recipient.userId}
                                      onClick={() => toggleRecipient(recipient)}
                                      className={`flex items-center gap-3 px-4 py-3 pl-12 cursor-pointer transition-colors ${isSelected ? 'bg-primary/5' : 'hover:bg-default-50'
                                        }`}
                                    >
                                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${isSelected ? 'border-primary bg-primary' : 'border-default-300'
                                        }`}>
                                        {isSelected && <HiOutlineCheck className="w-3 h-3 text-primary-foreground" />}
                                      </div>

                                      <div className="w-9 h-9 rounded-full bg-default-200 flex items-center justify-center overflow-hidden">
                                        {recipient.profilePicture ? (
                                          <img src={recipient.profilePicture} alt="" className="w-full h-full object-cover" />
                                        ) : (
                                          <HiOutlineUser className="w-5 h-5 text-default-400" />
                                        )}
                                      </div>

                                      <div className="flex-1 min-w-0">
                                        <p className="font-medium text-foreground truncate">
                                          {recipient.name}
                                        </p>
                                        <p className="text-sm text-default-500 truncate">
                                          {recipient.employeeCode} • {recipient.designation || 'Employee'}
                                        </p>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
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
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-primary/10 text-primary"
                        >
                          {r.name}
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleRecipient(r); }}
                            className="hover:opacity-70 transition-opacity"
                          >
                            <HiOutlineXMark className="w-4 h-4" />
                          </button>
                        </span>
                      ))}
                      {selectedRecipients.length > 5 && (
                        <span className="px-3 py-1.5 bg-default-200 text-default-500 rounded-full text-sm font-medium">
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
                  <div className="flex items-center gap-3 p-4 bg-default-100 rounded-2xl">
                    <div className="p-2.5 rounded-2xl bg-primary/10">
                      <HiOutlineUsers className="w-5 h-5 text-primary" />
                    </div>
                    <span className="text-default-700">
                      Sending to <strong className="text-foreground">{selectedRecipients.length}</strong> recipient(s)
                    </span>
                  </div>

                  {/* Template Selection */}
                  <div>
                    <label className="block text-sm font-medium text-default-700 mb-2">Quick Templates</label>
                    <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto">
                      {templates.slice(0, 6).map(template => (
                        <button
                          key={template.id}
                          onClick={() => handleTemplateSelect(template)}
                          className={`p-3 text-left border rounded-2xl transition-all ${selectedTemplate?.id === template.id
                              ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                              : 'border-default-300 hover:border-gray-400 hover:bg-default-50'
                            }`}
                        >
                          <p className="font-medium text-foreground truncate text-sm">{template.title}</p>
                          <span className={`inline-block mt-1 px-2 py-0.5 text-xs rounded-full font-medium ${priorityColors[template.priority]}`}>
                            {template.priority}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Custom Message */}
                  <div>
                    <label className="block text-sm font-medium text-default-700 mb-2">
                      Message <span className="text-default-400 font-normal">(supports placeholders)</span>
                    </label>
                    <textarea
                      value={customMessage}
                      onChange={(e) => setCustomMessage(e.target.value)}
                      placeholder="Enter your message... Use {senderName}, {receiverName}, {senderRole}, {receiverDepartment} as placeholders"
                      rows={4}
                      className="w-full px-4 py-3 border border-default-300 rounded-2xl bg-content1 text-foreground placeholder-gray-400 focus:ring-2 focus:ring-primary focus:border-primary transition-all resize-none"
                    />
                    <p className="mt-2 text-xs text-default-500">
                      Available: <code className="px-1 py-0.5 bg-default-100 rounded text-foreground">{'{senderName}'}</code>, <code className="px-1 py-0.5 bg-default-100 rounded text-foreground">{'{receiverName}'}</code>, <code className="px-1 py-0.5 bg-default-100 rounded text-foreground">{'{time}'}</code>, <code className="px-1 py-0.5 bg-default-100 rounded text-foreground">{'{date}'}</code>
                    </p>
                  </div>

                  {/* Priority & Voice Options */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-default-700 mb-2">Priority</label>
                      <Select
                        selectedKeys={[priority]}
                        onChange={(e) => setPriority(e.target.value)}
                        aria-label="Priority"
                        classNames={{ trigger: "bg-content1" }}
                      >
                        <SelectItem key="low">Low</SelectItem>
                        <SelectItem key="medium">Medium</SelectItem>
                        <SelectItem key="high">High</SelectItem>
                        <SelectItem key="urgent">Urgent</SelectItem>
                      </Select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-default-700 mb-2">Voice Alert (AI)</label>
                      <button
                        onClick={() => setGenerateVoice(!generateVoice)}
                        className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 border rounded-2xl transition-all font-medium ${generateVoice
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-default-300 text-default-500 hover:bg-default-50'
                          }`}
                      >
                        <HiOutlineSpeakerWave className="w-5 h-5" />
                        {generateVoice ? 'Voice Enabled' : 'Voice Disabled'}
                      </button>
                    </div>
                  </div>

                  {/* Preview */}
                  {customMessage && (
                    <div className="p-4 rounded-2xl border bg-primary/5 border-primary/20">
                      <p className="text-sm font-medium mb-2 text-primary">
                        Message Preview:
                      </p>
                      <p className="text-sm text-primary">
                        {customMessage
                          .replace('{senderName}', `${user?.firstName || 'You'} ${user?.lastName || ''}`.trim())
                          .replace('{senderRole}', getRoleDisplayLabel(user?.role))
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

            {/* Footer - Light gray background */}
            <div className="px-6 py-4 border-t border-default-200 bg-default-50 flex justify-between">
              {step === 1 ? (
                <>
                  <button
                    onClick={handleClose}
                    className="px-5 py-2.5 rounded-full border border-default-300 text-default-700 font-medium hover:bg-default-100 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => setStep(2)}
                    disabled={selectedRecipients.length === 0}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-full text-primary-foreground font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    style={selectedRecipients.length > 0 ? {
                      background: 'hsl(var(--heroui-primary))'
                    } : { backgroundColor: 'hsl(var(--heroui-default-300))' }}
                  >
                    Next
                    <HiOutlineArrowRight className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setStep(1)}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-full border border-default-300 text-default-700 font-medium hover:bg-default-100 transition-colors"
                  >
                    <HiOutlineArrowLeft className="w-4 h-4" />
                    Back
                  </button>
                  <button
                    onClick={sendAlert}
                    disabled={sending || !customMessage.trim()}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-full text-primary-foreground font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    style={!sending && customMessage.trim() ? {
                      background: 'hsl(var(--heroui-primary))'
                    } : { backgroundColor: 'hsl(var(--heroui-default-300))' }}
                  >
                    {sending ? (
                      <>
                        <Loader size="xs" color="#ffffff" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <HiOutlinePaperAirplane className="w-4 h-4" />
                        Send Alert
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </ModalPortal>
    </>
  );
}
