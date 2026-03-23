'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import WhiteboardCanvas from '@/components/whiteboard/WhiteboardCanvas';
import { Skeleton } from '@heroui/react';
import { FiArrowLeft, FiShare2, FiX, FiUsers, FiMaximize, FiMinimize } from 'react-icons/fi';
import ModalPortal from '@/components/ui/ModalPortal';
import useAuthedSWR from '@/hooks/useAuthedSWR';
import { DataErrorState } from '@/components/ui/ErrorBoundary';

export default function WhiteboardEditorPage() {
  const router = useRouter();
  const params = useParams();
  const boardId = params.id;
  const containerRef = useRef(null);
  const canvasRef = useRef(null);

  // SWR data fetching for board
  const { data: boardRes, error: boardError, isLoading: boardSWRLoading, mutate: refreshBoard } = useAuthedSWR(
    boardId ? `/api/whiteboard/${boardId}` : null
  );

  const board = boardRes?.whiteboard || null;
  const permission = boardRes?.permission || 'view_only';
  const loading = boardSWRLoading;
  const error = boardError?.message || null;
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [sharePermission, setSharePermission] = useState('view_only');
  const [sharing, setSharing] = useState([]);
  const [shareLoading, setShareLoading] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [userResults, setUserResults] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  // Sync sharing and newTitle from SWR data
  useEffect(() => {
    if (board) {
      setSharing(board.sharing || []);
      setNewTitle(board.title || '');
    }
  }, [board]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hasEnteredFullscreen, setHasEnteredFullscreen] = useState(false);
  const [isFilePickerOpen, setIsFilePickerOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Safe array length check helper
  const safeArrayLength = (arr) => Array.isArray(arr) ? arr.length : 0;

  // Enter fullscreen
  const enterFullscreen = useCallback(async () => {
    try {
      if (containerRef.current && !document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
        setIsFullscreen(true);
        setHasEnteredFullscreen(true);
      }
    } catch (err) {
      console.log('Fullscreen not supported or denied');
    }
  }, []);

  // Exit fullscreen
  const exitFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.log('Error exiting fullscreen');
    }
  }, []);

  // Handle fullscreen change events
  useEffect(() => {
    const handleFullscreenChange = async () => {
      const isNowFullscreen = !!document.fullscreenElement;
      setIsFullscreen(isNowFullscreen);

      // If user exits fullscreen (ESC key or other), re-enter fullscreen on next interaction
      // Don't navigate back - just allow re-entry on user action
      if (!isNowFullscreen && hasEnteredFullscreen && !isFilePickerOpen) {
        // Don't navigate away - we'll re-enter fullscreen on next user interaction
        // This prevents confusion and allows imports to work properly
      }

      // Re-enter fullscreen after file picker closes
      if (!isNowFullscreen && isFilePickerOpen) {
        // Wait a bit for file picker to fully close, then re-enter fullscreen
        setTimeout(() => {
          setIsFilePickerOpen(false);
          if (hasEnteredFullscreen) {
            enterFullscreen();
          }
        }, 500);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [hasEnteredFullscreen, router, isFilePickerOpen, enterFullscreen]);

  // Re-enter fullscreen on any user interaction when not in fullscreen
  useEffect(() => {
    const handleUserInteraction = () => {
      if (hasEnteredFullscreen && !document.fullscreenElement && !isFilePickerOpen) {
        enterFullscreen();
      }
    };

    // Listen for various user interactions
    const events = ['mousedown', 'touchstart', 'keydown'];
    events.forEach(event => {
      document.addEventListener(event, handleUserInteraction, { once: true });
    });

    return () => {
      events.forEach(event => {
        document.removeEventListener(event, handleUserInteraction);
      });
    };
  }, [hasEnteredFullscreen, isFilePickerOpen, enterFullscreen, isFullscreen]);

  // Auto-enter fullscreen when board loads
  useEffect(() => {
    if (board && !loading && !hasEnteredFullscreen) {
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => {
        enterFullscreen();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [board, loading, hasEnteredFullscreen, enterFullscreen]);

  const getAuthHeaders = () => {
    const token = localStorage.getItem('token');
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
  };

  // Search for users
  const searchUsers = useCallback(async (query = '') => {
    try {
      setLoadingUsers(true);
      const token = localStorage.getItem('token');
      const url = query ? `/api/users/search?q=${encodeURIComponent(query)}&limit=10` : `/api/users/search?limit=10`;
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();

      if (res.ok) {
        setUserResults(data.users || []);
      }
    } catch (err) {
      console.error('Error searching users:', err);
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  // Save handler
  const handleSave = useCallback(async (data) => {
    try {
      const res = await fetch(`/api/whiteboard/${boardId}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          pages: data.pages,
          theme: data.theme,
          showGrid: data.showGrid,
          thumbnail: data.thumbnail,
          aiAnalysis: data.aiAnalysis
        })
      });

      if (!res.ok) {
        const result = await res.json();
        console.error('Save failed:', result.error);
      }
    } catch (err) {
      console.error('Error saving:', err);
    }
  }, [boardId]);

  // Share handler
  const handleShareWithUser = async (userId) => {
    try {
      setShareLoading(true);
      const res = await fetch(`/api/whiteboard/${boardId}/share`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          userId,
          permission: sharePermission
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to share');

      setSharing(data.sharing);
      setUserSearch('');
      setUserResults([]);
      alert('Board shared successfully!');
    } catch (err) {
      alert(err.message);
    } finally {
      setShareLoading(false);
    }
  };

  const handleShare = async (e) => {
    e.preventDefault();
    if (!shareEmail.trim()) return;

    try {
      setShareLoading(true);
      const res = await fetch(`/api/whiteboard/${boardId}/share`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          email: shareEmail.trim(),
          permission: sharePermission
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to share');

      setSharing(data.sharing);
      setShareEmail('');
    } catch (err) {
      alert(err.message);
    } finally {
      setShareLoading(false);
    }
  };

  // Remove share
  const handleRemoveShare = async (userId) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/whiteboard/${boardId}/share?userId=${userId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (res.ok) {
        setSharing(prev => prev.filter(s => s.userId._id !== userId));
      }
    } catch (err) {
      console.error('Error removing share:', err);
    }
  };

  // Rename handler
  const handleRename = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    try {
      const res = await fetch(`/api/whiteboard/${boardId}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ title: newTitle.trim() })
      });

      if (res.ok) {
        setBoard(prev => ({ ...prev, title: newTitle.trim() }));
        setShowRenameModal(false);
      }
    } catch (err) {
      console.error('Error renaming:', err);
    }
  };

  // Close handler - save before exit, then exit fullscreen which will trigger navigation
  const handleClose = useCallback(async () => {
    // Force save before closing
    if (canvasRef.current?.isDirty) {
      setIsSaving(true);
      canvasRef.current.forceSave();
      // Wait a brief moment for save to complete
      await new Promise(resolve => setTimeout(resolve, 300));
      setIsSaving(false);
    }

    if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
    router.push('/dashboard/talioboard');
  }, [router]);

  // Handle Escape key to close board and navigate to dashboard
  useEffect(() => {
    const handleEscapeKey = async (e) => {
      if (e.key === 'Escape') {
        // Don't handle if user is in a text input or modal
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (showShareModal || showRenameModal) return;

        e.preventDefault();
        e.stopPropagation();
        await handleClose();
      }
    };

    window.addEventListener('keydown', handleEscapeKey);
    return () => window.removeEventListener('keydown', handleEscapeKey);
  }, [showShareModal, showRenameModal, handleClose]);

  // Toggle fullscreen
  const toggleFullscreen = () => {
    if (isFullscreen) {
      exitFullscreen();
    } else {
      enterFullscreen();
    }
  };

  if (loading) {
    return (
      <div className="h-screen flex flex-col bg-gray-50 whiteboard-light-override">
        <div className="flex items-center gap-4 px-4 py-3 bg-white border-b border-gray-200">
          <Skeleton className="w-8 h-8 rounded-lg" />
          <Skeleton className="h-6 w-48 rounded-lg" />
          <div className="flex-1" />
          <Skeleton className="w-20 h-8 rounded-lg" />
        </div>
        <div className="flex-1">
          <Skeleton className="w-full h-full" />
        </div>
      </div>
    );
  }

  if (error) {
    return <DataErrorState error={{ message: error }} onRetry={() => refreshBoard()} />;
  }

  if (!board) {
    return null;
  }

  return (
    <div ref={containerRef} className="h-screen flex flex-col bg-gray-50 whiteboard-light-override">
      {/* Saving overlay */}
      <ModalPortal isOpen={isSaving}>
        <div className="modal-overlay whiteboard-light-override">
          <div className="bg-white rounded-[30px] animate-modal-enter px-6 py-4 flex items-center gap-3 shadow-xl">
            <Skeleton className="w-5 h-5 rounded-full" />
            <span className="text-gray-700 font-medium">Saving...</span>
          </div>
        </div>
      </ModalPortal>

      {/* Header - FigJam style */}
      <div className="flex items-center gap-4 px-4 py-3 bg-white border-b border-gray-200">
        <button
          onClick={handleClose}
          className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          title="Exit (Esc)"
        >
          <FiArrowLeft size={20} />
        </button>

        <div className="h-6 w-px bg-gray-200" />

        <button
          onClick={() => permission === 'owner' && setShowRenameModal(true)}
          className={`text-lg font-semibold text-gray-900 ${permission === 'owner' ? 'hover:text-violet-600 cursor-pointer' : ''}`}
        >
          {board.title}
        </button>

        <div className="flex-1" />

        <button
          onClick={toggleFullscreen}
          className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
        >
          {isFullscreen ? <FiMinimize size={18} /> : <FiMaximize size={18} />}
        </button>

        {permission === 'owner' && (
          <button
            onClick={() => setShowShareModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors text-sm font-medium"
          >
            <FiShare2 size={16} />
            Share
          </button>
        )}

        {permission !== 'owner' && (
          <span className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-sm">
            <FiUsers size={14} />
            {permission === 'editor' ? 'Can edit' : 'View only'}
          </span>
        )}
      </div>

      {/* Canvas */}
      <div className="flex-1 overflow-hidden">
        <WhiteboardCanvas
          ref={canvasRef}
          boardId={boardId}
          initialData={board}
          onSave={handleSave}
          permission={permission}
          theme={board.theme}
          onFilePickerOpen={() => setIsFilePickerOpen(true)}
        />
      </div>

      {/* Share Modal */}
      <ModalPortal isOpen={showShareModal}>
        <div className="modal-overlay whiteboard-light-override">
          <div className="bg-white rounded-[30px] animate-modal-enter shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-gray-900">Share board</h2>
                <button
                  onClick={() => {
                    setShowShareModal(false);
                    setUserSearch('');
                    setUserResults([]);
                  }}
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <FiX size={20} />
                </button>
              </div>

              <div className="space-y-4 mb-6">
                <div className="relative">
                  <input
                    type="text"
                    value={userSearch}
                    onChange={(e) => {
                      setUserSearch(e.target.value);
                      searchUsers(e.target.value);
                    }}
                    onFocus={() => {
                      if (safeArrayLength(userResults) === 0) searchUsers('');
                    }}
                    placeholder="Search for users..."
                    className="input input-search"
                  />

                  {(userSearch || safeArrayLength(userResults) > 0) && (
                    <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-lg shadow-xl border border-gray-200 max-h-64 overflow-y-auto z-10">
                      {loadingUsers ? (
                        <div className="p-4 text-center text-gray-500">
                          <Skeleton className="w-5 h-5 rounded-full mx-auto mb-2" />
                          Searching...
                        </div>
                      ) : safeArrayLength(userResults) === 0 ? (
                        <div className="p-4 text-center text-gray-500 text-sm">
                          No users found
                        </div>
                      ) : (
                        <div className="divide-y divide-gray-100">
                          {userResults.map(user => (
                            <button
                              key={user._id}
                              onClick={() => handleShareWithUser(user._id)}
                              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                              disabled={sharing.some(s => s.userId._id === user._id)}
                            >
                              <div className="w-10 h-10 bg-gradient-to-br from-violet-400 to-purple-500 rounded-full flex items-center justify-center text-white font-medium flex-shrink-0">
                                {user.name?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || '?'}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-gray-900 truncate">
                                  {user.name || 'No Name'}
                                </div>
                                <div className="text-xs text-gray-500 truncate">{user.email}</div>
                              </div>
                              {sharing.some(s => s.userId._id === user._id) && (
                                <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded flex-shrink-0">
                                  Shared
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Permission:</span>
                  <select
                    value={sharePermission}
                    onChange={(e) => setSharePermission(e.target.value)}
                    className="px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                  >
                    <option value="view_only">View only</option>
                    <option value="editor">Can edit</option>
                  </select>
                </div>
              </div>

              {safeArrayLength(sharing) > 0 && (
                <div className="border-t border-gray-100 pt-6">
                  <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-4">Shared with</h3>
                  <div className="space-y-3">
                    {sharing.map(share => (
                      <div key={share.userId._id} className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-gradient-to-br from-violet-400 to-purple-500 rounded-full flex items-center justify-center text-white font-medium">
                            {share.userId.name?.[0]?.toUpperCase() || '?'}
                          </div>
                          <div>
                            <div className="text-sm font-medium text-gray-900">
                              {share.userId.name || share.userId.email}
                            </div>
                            <div className="text-xs text-gray-500">{share.userId.email}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded-md">
                            {share.permission === 'editor' ? 'Editor' : 'Viewer'}
                          </span>
                          <button
                            onClick={() => handleRemoveShare(share.userId._id)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <FiX size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </ModalPortal>

      {/* Rename Modal */}
      <ModalPortal isOpen={showRenameModal}>
        <div className="modal-overlay whiteboard-light-override">
          <div className="bg-white rounded-[30px] animate-modal-enter shadow-xl w-full max-w-sm overflow-hidden">
            <div className="p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Rename board</h2>
              <form onSubmit={handleRename}>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl bg-gray-50 text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent mb-6 text-lg"
                  autoFocus
                />
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowRenameModal(false)}
                    className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2.5 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors font-medium"
                  >
                    Save
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </ModalPortal>
    </div>
  );
}
