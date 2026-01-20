'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// Quirky loading messages for different phases
const LOADING_PHASES = {
  thinking: [
    "MIRA is brewing ideas...",
    "Neurons firing in digital space...",
    "Consulting the creative oracle...",
    "Connecting the dots...",
    "Mind mapping in progress...",
    "Inspiration loading...",
  ],
  structuring: [
    "Organizing thoughts into magic...",
    "Building your vision blueprint...",
    "Arranging ideas like stars...",
    "Crafting the perfect structure...",
    "Weaving concepts together...",
    "Shaping your canvas story...",
  ],
  finalizing: [
    "Adding the finishing touches...",
    "Polishing the gems...",
    "Almost ready to shine...",
    "Final flourishes incoming...",
    "Perfecting your masterpiece...",
    "Ready in 3... 2... 1...",
  ]
};

// Template icons and colors
const TEMPLATE_CONFIG = {
  mindmap: {
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v4m0 12v4m10-10h-4M6 12H2m15.5-7.5l-2.8 2.8m-5.4 5.4l-2.8 2.8m0-11l2.8 2.8m5.4 5.4l2.8 2.8" />
      </svg>
    ),
    gradient: 'from-purple-500 to-violet-600',
    lightGradient: 'from-purple-50 to-violet-100',
    border: 'border-purple-200',
    text: 'text-purple-700',
    label: 'Mindmap',
    description: 'Radial thought map with branches',
    prompt: 'What topic would you like to map out?',
  },
  flowchart: {
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="6" height="6" rx="1" />
        <rect x="15" y="3" width="6" height="6" rx="1" />
        <rect x="9" y="15" width="6" height="6" rx="1" />
        <path d="M6 9v3h6m6-3v3h-6m0 0v3" />
      </svg>
    ),
    gradient: 'from-blue-500 to-cyan-600',
    lightGradient: 'from-blue-50 to-cyan-100',
    border: 'border-blue-200',
    text: 'text-blue-700',
    label: 'Flowchart',
    description: 'Process flow with decisions',
    prompt: 'Describe the process you want to visualize.',
  },
  eventcircuit: {
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="5" r="3" />
        <path d="M12 8v2" />
        <circle cx="6" cy="14" r="2.5" />
        <circle cx="18" cy="14" r="2.5" />
        <circle cx="3" cy="20" r="2" />
        <circle cx="9" cy="20" r="2" />
        <circle cx="15" cy="20" r="2" />
        <circle cx="21" cy="20" r="2" />
        <path d="M12 10l-4.5 4M12 10l4.5 4M6 16.5l-2 1.5M6 16.5l2 1.5M18 16.5l-2 1.5M18 16.5l2 1.5" />
      </svg>
    ),
    gradient: 'from-rose-500 to-pink-600',
    lightGradient: 'from-rose-50 to-pink-100',
    border: 'border-rose-200',
    text: 'text-rose-700',
    label: 'Event Circuit',
    description: 'Decision chain reactions & outcomes',
    prompt: 'What decision or goal do you want to analyze?',
  },
  planning: {
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M9 21V9" />
      </svg>
    ),
    gradient: 'from-emerald-500 to-green-600',
    lightGradient: 'from-emerald-50 to-green-100',
    border: 'border-emerald-200',
    text: 'text-emerald-700',
    label: 'Planning',
    description: 'Kanban-style task organization',
    prompt: 'What project or tasks do you want to organize?',
  },
  ideas: {
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2a7 7 0 017 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 01-2 2h-4a2 2 0 01-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 017-7z" />
        <path d="M9 21h6" />
      </svg>
    ),
    gradient: 'from-amber-500 to-yellow-600',
    lightGradient: 'from-amber-50 to-yellow-100',
    border: 'border-amber-200',
    text: 'text-amber-700',
    label: 'Ideas',
    description: 'Creative brainstorming board',
    prompt: 'What theme do you want to brainstorm?',
  },
};

// Content Section Component (expandable)
const ContentSection = ({ 
  section, 
  index, 
  isExpanded, 
  onToggle, 
  onEdit, 
  onRegenerateSection,
  isEditing,
  onStartEdit,
  onSaveEdit,
  editValue,
  setEditValue,
  isLoading
}) => {
  const textareaRef = useRef(null);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [isEditing]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
      className={`rounded-xl border ${section.color?.border || 'border-gray-200'} bg-white overflow-hidden`}
    >
      {/* Section Header */}
      <div 
        className={`flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50 transition-colors ${section.color?.bg || 'bg-gray-50'}`}
        onClick={onToggle}
      >
        <div className="flex items-center gap-2">
          <svg className={`w-4 h-4 ${section.color?.text || 'text-gray-500'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          <span className={`font-medium text-sm ${section.color?.text || 'text-gray-700'}`}>
            {section.title}
          </span>
          {section.items?.length > 0 && (
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
              {section.items.length} items
            </span>
          )}
        </div>
        <motion.svg
          animate={{ rotate: isExpanded ? 180 : 0 }}
          className="w-4 h-4 text-gray-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M19 9l-7 7-7-7" />
        </motion.svg>
      </div>

      {/* Section Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-gray-100"
          >
            <div className="p-3 space-y-2">
              {/* Items list */}
              {section.items?.map((item, idx) => (
                <div key={idx} className="flex items-start gap-2 text-sm text-gray-600">
                  <span className="text-gray-300 mt-0.5">•</span>
                  <span className="flex-1">{item}</span>
                </div>
              ))}

              {/* Summary/conclusion if exists */}
              {section.summary && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-xs text-gray-500 font-medium mb-1">Summary:</p>
                  {isEditing ? (
                    <textarea
                      ref={textareaRef}
                      value={editValue}
                      onChange={(e) => {
                        setEditValue(e.target.value);
                        e.target.style.height = 'auto';
                        e.target.style.height = e.target.scrollHeight + 'px';
                      }}
                      className="w-full text-sm text-gray-600 bg-gray-50 rounded-lg p-2 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-300 resize-none"
                    />
                  ) : (
                    <p className="text-sm text-gray-600 italic">{section.summary}</p>
                  )}
                </div>
              )}

              {/* Section actions */}
              <div className="flex gap-2 mt-3 pt-2 border-t border-gray-100">
                {isEditing ? (
                  <>
                    <button
                      onClick={() => onSaveEdit(index)}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-600 transition-colors"
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                      Save
                    </button>
                    <button
                      onClick={() => onStartEdit(null)}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-600 transition-colors"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        setEditValue(section.summary || '');
                        onStartEdit(index);
                      }}
                      disabled={isLoading}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-600 transition-colors disabled:opacity-50"
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                      Edit
                    </button>
                    <button
                      onClick={() => onRegenerateSection(index)}
                      disabled={isLoading}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-violet-50 hover:bg-violet-100 text-violet-600 transition-colors disabled:opacity-50"
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 4v6h6M23 20v-6h-6" />
                        <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" />
                      </svg>
                      Regenerate
                    </button>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// Progress Bar Component
const LoadingProgress = ({ phase, progress, message }) => {
  const [displayMessage, setDisplayMessage] = useState(message);
  const messageIntervalRef = useRef(null);

  useEffect(() => {
    const messages = LOADING_PHASES[phase] || LOADING_PHASES.thinking;
    let idx = 0;
    
    setDisplayMessage(messages[0]);
    
    messageIntervalRef.current = setInterval(() => {
      idx = (idx + 1) % messages.length;
      setDisplayMessage(messages[idx]);
    }, 2000);

    return () => {
      if (messageIntervalRef.current) {
        clearInterval(messageIntervalRef.current);
      }
    };
  }, [phase]);

  return (
    <div className="space-y-3">
      {/* Progress bar */}
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>
      
      {/* Message */}
      <AnimatePresence mode="wait">
        <motion.p
          key={displayMessage}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
          className="text-sm text-gray-500 text-center"
        >
          {displayMessage}
        </motion.p>
      </AnimatePresence>

      {/* Animated dots */}
      <div className="flex justify-center gap-1">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="w-2 h-2 rounded-full bg-violet-400"
            animate={{
              scale: [1, 1.3, 1],
              opacity: [0.5, 1, 0.5],
            }}
            transition={{
              duration: 1,
              repeat: Infinity,
              delay: i * 0.2,
            }}
          />
        ))}
      </div>
    </div>
  );
};

// Helper function to get time ago string
const getTimeAgo = (date) => {
  const now = new Date();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// Main MiraAgentSidebar Component
export default function MiraAgentSidebar({
  isOpen,
  onClose,
  boardId,
  onStartPlotting,
  existingContent,
  onContentUpdate,
  isPlotted,
  // History props
  generations = [],
  currentGenerationId = null,
  onNewGeneration,
  onSelectGeneration,
}) {
  // State
  const [step, setStep] = useState('template'); // template, input, loading, preview, history
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [userInput, setUserInput] = useState('');
  const [preparedContent, setPreparedContent] = useState(null);
  const [expandedSections, setExpandedSections] = useState(new Set([0]));
  const [editingSection, setEditingSection] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState('thinking');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [chatInput, setChatInput] = useState('');
  const [error, setError] = useState(null);
  
  // Track content modifications after plotting
  const [contentModifiedAfterPlot, setContentModifiedAfterPlot] = useState(false);
  // Track the original plotted content hash to detect changes
  const [plottedContentHash, setPlottedContentHash] = useState(null);

  const inputRef = useRef(null);
  const chatInputRef = useRef(null);

  // Track if this is the first open (for initialization) vs toggle
  const hasInitializedRef = useRef(false);
  
  // Helper to create a simple hash of content for change detection
  const getContentHash = useCallback((content) => {
    if (!content) return null;
    const str = JSON.stringify({
      title: content.title,
      sections: content.sections?.map(s => ({ title: s.title, items: s.items })),
      conclusion: content.conclusion
    });
    return str.length + '_' + str.slice(0, 100);
  }, []);
  
  // Track when content is plotted to detect subsequent changes
  useEffect(() => {
    if (isPlotted && preparedContent && !plottedContentHash) {
      setPlottedContentHash(getContentHash(preparedContent));
      setContentModifiedAfterPlot(false);
    }
  }, [isPlotted, preparedContent, plottedContentHash, getContentHash]);
  
  // Detect content modifications after plotting
  useEffect(() => {
    if (isPlotted && plottedContentHash && preparedContent) {
      const currentHash = getContentHash(preparedContent);
      if (currentHash !== plottedContentHash) {
        setContentModifiedAfterPlot(true);
      }
    }
  }, [preparedContent, isPlotted, plottedContentHash, getContentHash]);

  // Initialize content when opening - but only reset if explicitly requested
  useEffect(() => {
    if (isOpen) {
      // If we have existing content from the database, restore it
      if (existingContent && !hasInitializedRef.current) {
        setPreparedContent(existingContent);
        setSelectedTemplate(existingContent.templateType || 'mindmap');
        setUserInput(existingContent.userPrompt || '');
        setStep('preview');
        hasInitializedRef.current = true;
        return;
      }
      
      // If sidebar was just toggled back open (not first open), preserve current state
      if (hasInitializedRef.current && preparedContent) {
        // Already have content, don't reset - just ensure we're in preview mode
        if (step === 'template' || !step) {
          setStep('preview');
        }
        return;
      }
      
      // Check for pre-selected template from button click
      const preSelectedTemplate = typeof window !== 'undefined' ? window.__miraSidebarTemplateType : null;
      const initialPrompt = typeof window !== 'undefined' ? window.__miraSidebarInitialPrompt : null;
      
      if (preSelectedTemplate && TEMPLATE_CONFIG[preSelectedTemplate]) {
        setSelectedTemplate(preSelectedTemplate);
        setStep('input');
        if (initialPrompt) {
          setUserInput(initialPrompt);
          window.__miraSidebarInitialPrompt = null;
        }
        window.__miraSidebarTemplateType = null;
        hasInitializedRef.current = true;
      } else if (initialPrompt) {
        setStep('template');
        setSelectedTemplate(null);
        window.__miraSidebarPendingPrompt = initialPrompt;
        window.__miraSidebarInitialPrompt = null;
        hasInitializedRef.current = true;
      } else if (!hasInitializedRef.current) {
        // Only reset on true first open with no content
        setStep('template');
        setSelectedTemplate(null);
        setUserInput('');
        setPreparedContent(null);
        hasInitializedRef.current = true;
      }
      setError(null);
    }
  }, [isOpen, existingContent]);

  // Handle pending prompt after template selection
  useEffect(() => {
    if (step === 'input' && selectedTemplate) {
      const pendingPrompt = typeof window !== 'undefined' ? window.__miraSidebarPendingPrompt : null;
      if (pendingPrompt) {
        setUserInput(pendingPrompt);
        window.__miraSidebarPendingPrompt = null;
      }
    }
  }, [step, selectedTemplate]);

  // Focus input when entering input step
  useEffect(() => {
    if (step === 'input' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [step]);

  // Handle template selection
  const handleTemplateSelect = (templateKey) => {
    setSelectedTemplate(templateKey);
    setStep('input');
  };

  // Prepare content from AI
  const prepareContent = async () => {
    if (!userInput.trim() || !selectedTemplate) return;

    setStep('loading');
    setIsLoading(true);
    setLoadingProgress(0);
    setLoadingPhase('thinking');
    setError(null);

    // Simulate progress phases
    const progressInterval = setInterval(() => {
      setLoadingProgress(prev => {
        if (prev < 30) return prev + 2;
        if (prev < 60) {
          setLoadingPhase('structuring');
          return prev + 1.5;
        }
        if (prev < 90) {
          setLoadingPhase('finalizing');
          return prev + 1;
        }
        return prev;
      });
    }, 200);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/whiteboard/${boardId}/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'prepare',
          message: userInput,
          templateType: selectedTemplate,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to prepare content');
      }

      clearInterval(progressInterval);
      setLoadingProgress(100);

      setTimeout(() => {
        setPreparedContent(data.content);
        setStep('preview');
        setIsLoading(false);
      }, 500);

    } catch (err) {
      clearInterval(progressInterval);
      setError(err.message);
      setIsLoading(false);
      setStep('input');
    }
  };

  // Expand a section (ask AI for more details)
  const handleExpandSection = async (sectionIndex) => {
    if (!preparedContent?.sections?.[sectionIndex]) return;

    setIsLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const section = preparedContent.sections[sectionIndex];

      const response = await fetch(`/api/whiteboard/${boardId}/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'expand-section',
          sectionIndex,
          sectionTitle: section.title,
          currentContent: section,
          fullContext: preparedContent,
          templateType: selectedTemplate,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to expand section');
      }

      // Update the section with expanded content
      const updatedContent = { ...preparedContent };
      updatedContent.sections[sectionIndex] = data.expandedSection;
      setPreparedContent(updatedContent);
      onContentUpdate?.(updatedContent);

    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Regenerate a section
  const handleRegenerateSection = async (sectionIndex) => {
    if (!preparedContent?.sections?.[sectionIndex]) return;

    setIsLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const section = preparedContent.sections[sectionIndex];

      const response = await fetch(`/api/whiteboard/${boardId}/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'regenerate-section',
          sectionIndex,
          sectionTitle: section.title,
          originalPrompt: userInput,
          fullContext: preparedContent,
          templateType: selectedTemplate,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to regenerate section');
      }

      // Update the section with new content
      const updatedContent = { ...preparedContent };
      updatedContent.sections[sectionIndex] = data.regeneratedSection;
      setPreparedContent(updatedContent);
      onContentUpdate?.(updatedContent);

    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle section edit save
  const handleSaveEdit = (sectionIndex) => {
    if (!preparedContent?.sections?.[sectionIndex]) return;

    const updatedContent = { ...preparedContent };
    updatedContent.sections[sectionIndex].summary = editValue;
    setPreparedContent(updatedContent);
    onContentUpdate?.(updatedContent);
    setEditingSection(null);
    setEditValue('');
  };

  // Chat to edit content
  const handleChatEdit = async () => {
    if (!chatInput.trim() || !preparedContent) return;

    setIsLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');

      const response = await fetch(`/api/whiteboard/${boardId}/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'edit-content',
          editInstruction: chatInput,
          currentContent: preparedContent,
          templateType: selectedTemplate,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to edit content');
      }

      setPreparedContent(data.updatedContent);
      onContentUpdate?.(data.updatedContent);
      setChatInput('');

    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Toggle section expansion
  const toggleSection = (index) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  // Start plotting on canvas
  const handleStartPlotting = () => {
    if (preparedContent) {
      // Include the userPrompt for history tracking
      const contentWithPrompt = {
        ...preparedContent,
        userPrompt: userInput,
        templateType: selectedTemplate
      };
      onStartPlotting(contentWithPrompt, selectedTemplate);
      // Reset modification tracking after plotting
      setPlottedContentHash(getContentHash(preparedContent));
      setContentModifiedAfterPlot(false);
    }
  };
  
  // Update existing plot with modified content
  const handleUpdatePlotting = () => {
    if (preparedContent) {
      const contentWithPrompt = {
        ...preparedContent,
        userPrompt: userInput,
        templateType: selectedTemplate,
        isUpdate: true // Flag to indicate this is an update
      };
      onStartPlotting(contentWithPrompt, selectedTemplate);
      // Reset modification tracking
      setPlottedContentHash(getContentHash(preparedContent));
      setContentModifiedAfterPlot(false);
    }
  };
  
  // Start a fresh new generation (resets plotting state)
  const handleNewGeneration = () => {
    setPreparedContent(null);
    setUserInput('');
    setSelectedTemplate(null);
    setStep('template');
    setPlottedContentHash(null);
    setContentModifiedAfterPlot(false);
    hasInitializedRef.current = true; // Prevent auto-restore of old content
    if (onNewGeneration) onNewGeneration();
  };

  // Regenerate all content
  const handleRegenerateAll = () => {
    setPreparedContent(null);
    setStep('input');
  };

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ x: -400, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -400, opacity: 0 }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      className="fixed left-0 top-0 bottom-0 w-[30vw] min-w-[360px] max-w-[480px] 
        bg-white
        border-r border-gray-200 shadow-2xl z-50
        flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg">
            <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          </div>
          <div>
            <h2 className="font-semibold text-gray-800">MIRA Agent</h2>
            <p className="text-xs text-gray-500">
              {step === 'template' && 'Choose a template'}
              {step === 'input' && 'Describe your content'}
              {step === 'loading' && 'Preparing your content...'}
              {step === 'preview' && 'Review & customize'}
              {step === 'history' && 'Generation history'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* History toggle */}
          {generations.length > 0 && step !== 'history' && (
            <button
              onClick={() => setStep('history')}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              title="View history"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </button>
          )}
          {/* New generation button */}
          {(step === 'preview' || step === 'history') && (
            <button
              onClick={() => {
                if (onNewGeneration) {
                  onNewGeneration();
                }
                // Reset state for new generation
                setSelectedTemplate(null);
                setUserInput('');
                setPreparedContent(null);
                setStep('template');
                setError(null);
              }}
              className="p-2 rounded-lg bg-violet-100 hover:bg-violet-200 text-violet-600 transition-colors"
              title="New generation"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          )}
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          {/* Step 1: Template Selection */}
          {step === 'template' && (
            <motion.div
              key="template"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="p-4 space-y-4"
            >
              <div className="text-center py-4">
                <h3 className="text-lg font-medium text-gray-800 mb-2">
                  What would you like to create?
                </h3>
                <p className="text-sm text-gray-500">
                  Select a template to get started with structured content
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {Object.entries(TEMPLATE_CONFIG).map(([key, config]) => (
                  <motion.button
                    key={key}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleTemplateSelect(key)}
                    className={`flex flex-col items-center gap-2 p-4 rounded-xl bg-gradient-to-br ${config.lightGradient} ${config.border} border hover:shadow-md transition-all`}
                  >
                    <div className={`w-12 h-12 rounded-lg bg-gradient-to-br ${config.gradient} flex items-center justify-center text-white shadow-md`}>
                      {config.icon}
                    </div>
                    <span className={`font-medium text-sm ${config.text}`}>{config.label}</span>
                    <span className="text-xs text-gray-500 text-center">{config.description}</span>
                  </motion.button>
                ))}
              </div>

              {/* History Section - show recent generations */}
              {generations.length > 0 && (
                <div className="mt-6 pt-4 border-t border-gray-200">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2">
                      <svg className="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      Recent Generations
                    </h4>
                    <button
                      onClick={() => setStep('history')}
                      className="text-xs text-violet-600 hover:text-violet-700 font-medium"
                    >
                      View all →
                    </button>
                  </div>
                  <div className="space-y-2">
                    {generations.slice(0, 3).map((gen) => {
                      const templateConfig = TEMPLATE_CONFIG[gen.templateType] || TEMPLATE_CONFIG.mindmap;
                      const date = new Date(gen.createdAt);
                      const timeAgo = getTimeAgo(date);
                      
                      return (
                        <motion.button
                          key={gen.id}
                          whileHover={{ scale: 1.01 }}
                          whileTap={{ scale: 0.99 }}
                          onClick={() => {
                            if (onSelectGeneration) onSelectGeneration(gen.id);
                            setPreparedContent({
                              title: gen.title,
                              description: gen.description,
                              sections: gen.sections,
                              conclusion: gen.conclusion,
                              templateType: gen.templateType,
                              userPrompt: gen.userPrompt,
                              isPlotted: gen.isPlotted,
                            });
                            setSelectedTemplate(gen.templateType);
                            setUserInput(gen.userPrompt || '');
                            setStep('preview');
                          }}
                          className="w-full flex items-center gap-3 p-2.5 rounded-lg border border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50 transition-all text-left"
                        >
                          <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${templateConfig.gradient} flex items-center justify-center text-white shadow-sm flex-shrink-0`}>
                            <div className="scale-75">{templateConfig.icon}</div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm text-gray-800 truncate">
                                {gen.title || gen.userPrompt?.slice(0, 25) || 'Untitled'}
                              </span>
                              {gen.isPlotted && (
                                <span className="px-1.5 py-0.5 text-[10px] rounded bg-emerald-100 text-emerald-600 flex-shrink-0">
                                  ✓
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-gray-400">{timeAgo}</span>
                          </div>
                        </motion.button>
                      );
                    })}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* Step 2: User Input */}
          {step === 'input' && selectedTemplate && (
            <motion.div
              key="input"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="p-4 space-y-4"
            >
              {/* Selected template indicator */}
              <div className={`flex items-center gap-3 p-3 rounded-xl bg-gradient-to-br ${TEMPLATE_CONFIG[selectedTemplate].lightGradient} ${TEMPLATE_CONFIG[selectedTemplate].border} border`}>
                <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${TEMPLATE_CONFIG[selectedTemplate].gradient} flex items-center justify-center text-white shadow-md`}>
                  {TEMPLATE_CONFIG[selectedTemplate].icon}
                </div>
                <div className="flex-1">
                  <span className={`font-medium text-sm ${TEMPLATE_CONFIG[selectedTemplate].text}`}>
                    {TEMPLATE_CONFIG[selectedTemplate].label}
                  </span>
                  <p className="text-xs text-gray-500">{TEMPLATE_CONFIG[selectedTemplate].description}</p>
                </div>
                <button
                  onClick={() => setStep('template')}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  Change
                </button>
              </div>

              {/* Input area */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">
                  {TEMPLATE_CONFIG[selectedTemplate].prompt}
                </label>
                <textarea
                  ref={inputRef}
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      prepareContent();
                    }
                  }}
                  placeholder="Be as detailed as you'd like. The more context you provide, the better the result..."
                  rows={6}
                  className="w-full px-4 py-3 rounded-xl bg-white border border-gray-200 
                    text-sm text-gray-800 placeholder-gray-400
                    focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-300
                    transition-all resize-none"
                />
                <p className="text-xs text-gray-400">Press Ctrl+Enter to generate</p>
              </div>

              {/* Error display */}
              {error && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600">
                  {error}
                </div>
              )}

              {/* Generate button */}
              <button
                onClick={prepareContent}
                disabled={!userInput.trim() || isLoading}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 
                  text-white font-medium shadow-md hover:shadow-lg 
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-all"
              >
                {isLoading ? 'Generating...' : '✨ Generate Content'}
              </button>
            </motion.div>
          )}

          {/* Step 3: Loading */}
          {step === 'loading' && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="p-6 flex flex-col items-center justify-center min-h-[400px]"
            >
              <div className="w-20 h-20 mb-6 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                >
                  <svg className="w-10 h-10 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                  </svg>
                </motion.div>
              </div>

              <div className="w-full max-w-xs">
                <LoadingProgress 
                  phase={loadingPhase} 
                  progress={loadingProgress}
                  message={LOADING_PHASES[loadingPhase]?.[0]}
                />
              </div>
            </motion.div>
          )}

          {/* Step 4: Preview & Edit */}
          {step === 'preview' && preparedContent && (
            <motion.div
              key="preview"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="p-4 space-y-4"
            >
              {/* Title and summary */}
              <div className="text-center py-2">
                <h3 className="text-lg font-semibold text-gray-800 mb-1">
                  {preparedContent.title || 'Your Content'}
                </h3>
                {preparedContent.description && (
                  <p className="text-sm text-gray-500">{preparedContent.description}</p>
                )}
              </div>

              {/* Content sections */}
              <div className="space-y-3">
                {preparedContent.sections?.map((section, index) => (
                  <ContentSection
                    key={index}
                    section={section}
                    index={index}
                    isExpanded={expandedSections.has(index)}
                    onToggle={() => toggleSection(index)}
                    onEdit={() => handleExpandSection(index)}
                    onRegenerateSection={() => handleRegenerateSection(index)}
                    isEditing={editingSection === index}
                    onStartEdit={setEditingSection}
                    onSaveEdit={handleSaveEdit}
                    editValue={editValue}
                    setEditValue={setEditValue}
                    isLoading={isLoading}
                  />
                ))}
              </div>

              {/* Overall conclusion */}
              {preparedContent.conclusion && (
                <div className="p-4 rounded-xl bg-gradient-to-br from-violet-50 to-purple-50 border border-violet-200">
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="w-4 h-4 text-violet-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 16v-4M12 8h.01" />
                    </svg>
                    <span className="font-medium text-sm text-violet-700">Key Takeaway</span>
                  </div>
                  <p className="text-sm text-gray-600">{preparedContent.conclusion}</p>
                </div>
              )}

              {/* Chat edit input */}
              <div className="pt-3 border-t border-gray-200">
                <p className="text-xs text-gray-500 mb-2">Ask MIRA to make changes:</p>
                <div className="flex gap-2">
                  <input
                    ref={chatInputRef}
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleChatEdit();
                      }
                    }}
                    placeholder="e.g., Add more details to the first section..."
                    className="flex-1 px-3 py-2 rounded-lg bg-white border border-gray-200 
                      text-sm text-gray-800 placeholder-gray-400
                      focus:outline-none focus:ring-2 focus:ring-violet-400/40
                      transition-all"
                    disabled={isLoading}
                  />
                  <button
                    onClick={handleChatEdit}
                    disabled={!chatInput.trim() || isLoading}
                    className="px-4 py-2 rounded-lg bg-violet-500 text-white 
                      disabled:opacity-50 disabled:cursor-not-allowed
                      hover:bg-violet-600 transition-colors"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Error display */}
              {error && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600">
                  {error}
                </div>
              )}
            </motion.div>
          )}

          {/* Step: History View */}
          {step === 'history' && (
            <motion.div
              key="history"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="p-4 space-y-4"
            >
              <div className="text-center py-2">
                <h3 className="text-lg font-medium text-gray-800 mb-1">
                  Generation History
                </h3>
                <p className="text-sm text-gray-500">
                  View and manage your previous generations
                </p>
              </div>

              {generations.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <svg className="w-12 h-12 mx-auto mb-3 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  <p className="text-sm">No generations yet</p>
                  <p className="text-xs mt-1">Create your first generation to see it here</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {generations.map((gen) => {
                    const templateConfig = TEMPLATE_CONFIG[gen.templateType] || TEMPLATE_CONFIG.mindmap;
                    const isActive = gen.id === currentGenerationId;
                    const date = new Date(gen.createdAt);
                    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                    
                    return (
                      <motion.button
                        key={gen.id}
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                        onClick={() => {
                          if (onSelectGeneration) {
                            onSelectGeneration(gen.id);
                          }
                          setPreparedContent({
                            title: gen.title,
                            description: gen.description,
                            sections: gen.sections,
                            conclusion: gen.conclusion,
                            templateType: gen.templateType,
                            userPrompt: gen.userPrompt,
                            isPlotted: gen.isPlotted,
                          });
                          setSelectedTemplate(gen.templateType);
                          setUserInput(gen.userPrompt || '');
                          setStep('preview');
                        }}
                        className={`w-full flex items-start gap-3 p-3 rounded-xl border transition-all text-left
                          ${isActive 
                            ? `bg-gradient-to-br ${templateConfig.lightGradient} ${templateConfig.border} ring-2 ring-violet-300` 
                            : 'bg-white hover:bg-gray-50 border-gray-200 hover:border-gray-300'
                          }`}
                      >
                        <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${templateConfig.gradient} flex items-center justify-center text-white shadow-md flex-shrink-0`}>
                          {templateConfig.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`font-medium text-sm truncate ${isActive ? templateConfig.text : 'text-gray-800'}`}>
                              {gen.title || gen.userPrompt?.slice(0, 30) || 'Untitled'}
                            </span>
                            {gen.isPlotted && (
                              <span className="px-1.5 py-0.5 text-xs rounded bg-emerald-100 text-emerald-600 flex-shrink-0">
                                Plotted
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-gray-400">{templateConfig.label}</span>
                            <span className="text-gray-300">•</span>
                            <span className="text-xs text-gray-400">{dateStr} at {timeStr}</span>
                          </div>
                          {gen.userPrompt && (
                            <p className="text-xs text-gray-500 mt-1 line-clamp-2">{gen.userPrompt}</p>
                          )}
                        </div>
                        {isActive && (
                          <div className="flex-shrink-0 w-2 h-2 rounded-full bg-violet-500 mt-2"></div>
                        )}
                      </motion.button>
                    );
                  })}
                </div>
              )}

              {/* Back button */}
              <button
                onClick={() => {
                  if (preparedContent) {
                    setStep('preview');
                  } else {
                    setStep('template');
                  }
                }}
                className="w-full py-2 rounded-lg border border-gray-200 text-gray-600 text-sm hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
                Back
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Sticky Footer with Action Buttons - Always visible when in preview step */}
      {step === 'preview' && preparedContent && !isPlotted && (
        <div className="flex-shrink-0 p-4 border-t border-gray-200 bg-white shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
          <div className="flex gap-3">
            <button
              onClick={handleRegenerateAll}
              disabled={isLoading}
              className="flex-1 py-3 rounded-xl bg-gray-100 hover:bg-gray-200 
                text-gray-700 font-medium text-sm
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 4v6h6M23 20v-6h-6" />
                <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" />
              </svg>
              Regenerate All
            </button>
            <button
              onClick={handleStartPlotting}
              disabled={isLoading}
              className="flex-1 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 
                text-white font-medium text-sm shadow-md hover:shadow-lg
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-all flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Start Plotting
            </button>
          </div>
        </div>
      )}

      {/* Footer when content is plotted - show update option if modified */}
      {isPlotted && step === 'preview' && (
        <div className="flex-shrink-0 p-4 border-t border-gray-200 bg-white shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
          {/* Show Update Plot button if content was modified after plotting */}
          {contentModifiedAfterPlot ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
                <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>Content has been modified since last plot</span>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleNewGeneration}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 
                    text-gray-700 font-medium text-sm
                    transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  New
                </button>
                <button
                  onClick={handleUpdatePlotting}
                  disabled={isLoading}
                  className="flex-[2] py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 
                    text-white font-medium text-sm shadow-md hover:shadow-lg
                    disabled:opacity-50 disabled:cursor-not-allowed
                    transition-all flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 4v6h6M23 20v-6h-6" />
                    <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" />
                  </svg>
                  Update Plot
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span>Plotted on canvas</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleNewGeneration}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 
                    text-gray-600 text-sm font-medium
                    transition-colors flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  New Generation
                </button>
                <button
                  onClick={onClose}
                  className="text-violet-600 hover:text-violet-700 font-medium text-sm"
                >
                  Minimize
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
