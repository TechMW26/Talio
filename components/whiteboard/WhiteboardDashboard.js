'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FiPlus, FiSearch, FiGrid, FiList, FiMoreHorizontal, FiTrash2, FiEdit2, FiShare2, FiClock, FiUser, FiUsers, FiX, FiLink, FiCopy, FiCheck } from 'react-icons/fi';
import { useTheme } from '@/contexts/ThemeContext';
import Loader from '@/components/ui/Loader';
import { handleSessionExpired } from '@/utils/userHelper';

export default function WhiteboardDashboard() {
  const router = useRouter();
  const [boards, setBoards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('grid');
  const [showNewBoardModal, setShowNewBoardModal] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');
  const [creating, setCreating] = useState(false);
  const [activeMenu, setActiveMenu] = useState(null);
  const [error, setError] = useState(null);
  
  // Rename modal state
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameBoard, setRenameBoard] = useState(null);
  const [newTitle, setNewTitle] = useState('');
  const [renaming, setRenaming] = useState(false);
  
  // Share modal state
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareBoard, setShareBoard] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchBoards();
  }, []);

  const fetchBoards = async () => {
    try {
      setLoading(true);
      setError(null);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/whiteboard', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      // Handle 401 - session expired
      if (response.status === 401) {
        handleSessionExpired();
        return;
      }
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to fetch boards');
      }
      
      const data = await response.json();
      setBoards(data.boards || []);
    } catch (err) {
      console.error('Error fetching boards:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const createBoard = async () => {
    if (!newBoardName.trim()) return;
    
    try {
      setCreating(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/whiteboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ title: newBoardName.trim() })
      });
      
      if (!response.ok) {
        if (response.status === 401) {
          handleSessionExpired();
          return;
        }
        const data = await response.json();
        throw new Error(data.error || 'Failed to create board');
      }
      
      const data = await response.json();
      setShowNewBoardModal(false);
      setNewBoardName('');
      router.push(`/dashboard/talioboard/${data.whiteboard._id}`);
    } catch (err) {
      console.error('Error creating board:', err);
      alert('Failed to create board: ' + err.message);
    } finally {
      setCreating(false);
    }
  };

  const deleteBoard = async (boardId) => {
    if (!confirm('Are you sure you want to delete this board?')) return;
    
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/whiteboard/${boardId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!response.ok) {
        if (response.status === 401) {
          handleSessionExpired();
          return;
        }
        throw new Error('Failed to delete board');
      }
      
      setBoards(boards.filter(b => b._id !== boardId));
      setActiveMenu(null);
    } catch (err) {
      console.error('Error deleting board:', err);
      alert('Failed to delete board');
    }
  };

  const handleRename = async () => {
    if (!newTitle.trim() || !renameBoard) return;
    
    try {
      setRenaming(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/whiteboard/${renameBoard._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ title: newTitle.trim() })
      });
      
      if (!response.ok) {
        if (response.status === 401) {
          handleSessionExpired();
          return;
        }
        throw new Error('Failed to rename board');
      }
      
      setBoards(boards.map(b => 
        b._id === renameBoard._id ? { ...b, title: newTitle.trim(), name: newTitle.trim() } : b
      ));
      setShowRenameModal(false);
      setRenameBoard(null);
      setNewTitle('');
    } catch (err) {
      console.error('Error renaming board:', err);
      alert('Failed to rename board');
    } finally {
      setRenaming(false);
    }
  };

  const openRenameModal = (board) => {
    setRenameBoard(board);
    setNewTitle(board.title || board.name || '');
    setShowRenameModal(true);
    setActiveMenu(null);
  };

  const openShareModal = (board) => {
    setShareBoard(board);
    setShowShareModal(true);
    setActiveMenu(null);
    setCopied(false);
  };

  const copyShareLink = () => {
    if (!shareBoard) return;
    const link = `${window.location.origin}/dashboard/talioboard/${shareBoard._id}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatDate = (date) => {
    if (!date) return 'Recently';
    const d = new Date(date);
    if (isNaN(d.getTime())) return 'Recently';
    
    const now = new Date();
    const diff = now - d;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const filteredBoards = boards.filter(board =>
    (board.title || board.name || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const ownedBoards = filteredBoards.filter(b => b.isOwner);
  const sharedBoards = filteredBoards.filter(b => !b.isOwner);

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg-main)' }}>
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">TalioBoard</h1>
              <p className="text-sm text-gray-500 mt-0.5">Collaborative whiteboards for your team</p>
            </div>
            
            <button
              onClick={() => setShowNewBoardModal(true)}
              className="btn btn-primary"
            >
              <FiPlus size={18} />
              <span>New board</span>
            </button>
          </div>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between gap-4">
          <div className="input-with-icon flex-1 max-w-md">
            <FiSearch className="input-icon" size={18} />
            <input
              type="text"
              placeholder="Search boards..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input input-search"
            />
          </div>
          
          <div className="view-toggle">
            <button
              onClick={() => setViewMode('grid')}
              className={`view-toggle-btn ${viewMode === 'grid' ? 'view-toggle-btn-active' : ''}`}
            >
              <FiGrid size={18} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`view-toggle-btn ${viewMode === 'list' ? 'view-toggle-btn-active' : ''}`}
            >
              <FiList size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 pb-12">
        {loading ? (
          <div className="loading-container py-20">
            <Loader size="lg" />
          </div>
        ) : error ? (
          <div className="empty-state py-20">
            <div className="empty-state-icon" style={{ backgroundColor: '#fee2e2' }}>
              <span>⚠️</span>
            </div>
            <h3 className="empty-state-title">Error loading boards</h3>
            <p className="empty-state-description">{error}</p>
            <button onClick={fetchBoards} className="btn btn-primary">
              Try again
            </button>
          </div>
        ) : filteredBoards.length === 0 ? (
          <div className="empty-state py-20">
            <div className="empty-state-icon">
              <span>🎨</span>
            </div>
            <h3 className="empty-state-title">
              {searchQuery ? 'No boards found' : 'No boards yet'}
            </h3>
            <p className="empty-state-description">
              {searchQuery ? 'Try a different search term' : 'Create your first board to get started'}
            </p>
            {!searchQuery && (
              <button onClick={() => setShowNewBoardModal(true)} className="btn btn-primary">
                <FiPlus size={18} />
                Create board
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-8">
            {/* Owned Boards */}
            {ownedBoards.length > 0 && (
              <section>
                <div className="section-header">
                  <FiUser size={16} className="text-gray-400" />
                  <h2 className="section-title">My Boards</h2>
                  <span className="section-count">{ownedBoards.length}</span>
                </div>
                <BoardGrid boards={ownedBoards} viewMode={viewMode} activeMenu={activeMenu} setActiveMenu={setActiveMenu} deleteBoard={deleteBoard} formatDate={formatDate} router={router} openRenameModal={openRenameModal} openShareModal={openShareModal} />
              </section>
            )}

            {/* Shared Boards */}
            {sharedBoards.length > 0 && (
              <section>
                <div className="section-header">
                  <FiUsers size={16} className="text-gray-400" />
                  <h2 className="section-title">Shared with me</h2>
                  <span className="section-count">{sharedBoards.length}</span>
                </div>
                <BoardGrid boards={sharedBoards} viewMode={viewMode} activeMenu={activeMenu} setActiveMenu={setActiveMenu} deleteBoard={deleteBoard} formatDate={formatDate} router={router} openRenameModal={openRenameModal} openShareModal={openShareModal} />
              </section>
            )}
          </div>
        )}
      </div>

      {/* New Board Modal */}
      {showNewBoardModal && (
        <div className="modal-backdrop">
          <div 
            className="modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-body">
              <h2 className="modal-title mb-1">Create new board</h2>
              <p className="text-sm text-gray-500 mb-6">Give your board a name to get started</p>
              
              <input
                type="text"
                placeholder="Board name"
                value={newBoardName}
                onChange={(e) => setNewBoardName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createBoard()}
                autoFocus
                className="input text-lg"
              />
            </div>
            
            <div className="modal-footer">
              <button
                onClick={() => {
                  setShowNewBoardModal(false);
                  setNewBoardName('');
                }}
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button
                onClick={createBoard}
                disabled={!newBoardName.trim() || creating}
                className="btn btn-primary"
              >
                {creating ? 'Creating...' : 'Create board'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {showRenameModal && renameBoard && (
        <div className="modal-backdrop" onClick={() => setShowRenameModal(false)}>
          <div 
            className="modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header flex items-center justify-between">
              <h2 className="modal-title">Rename board</h2>
              <button onClick={() => setShowRenameModal(false)} className="btn btn-ghost btn-icon">
                <FiX size={18} />
              </button>
            </div>
            
            <div className="modal-body">
              <input
                type="text"
                placeholder="Board name"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                autoFocus
                className="input text-lg"
              />
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setShowRenameModal(false)} className="btn btn-ghost">
                Cancel
              </button>
              <button
                onClick={handleRename}
                disabled={!newTitle.trim() || renaming}
                className="btn btn-primary"
              >
                {renaming ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {showShareModal && shareBoard && (
        <div className="modal-backdrop" onClick={() => setShowShareModal(false)}>
          <div 
            className="modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header flex items-center justify-between">
              <h2 className="modal-title">Share board</h2>
              <button onClick={() => setShowShareModal(false)} className="btn btn-ghost btn-icon">
                <FiX size={18} />
              </button>
            </div>
            
            <div className="modal-body">
              <p className="text-gray-600 mb-4">Share "{shareBoard.title || shareBoard.name}" with others</p>
              
              <div className="flex gap-2">
                <div className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-600 text-sm truncate">
                  {typeof window !== 'undefined' ? `${window.location.origin}/dashboard/talioboard/${shareBoard._id}` : ''}
                </div>
                <button
                  onClick={copyShareLink}
                  className={`btn ${copied ? 'btn-success' : 'btn-primary'}`}
                >
                  {copied ? <FiCheck size={18} /> : <FiCopy size={18} />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BoardGrid({ boards, viewMode, activeMenu, setActiveMenu, deleteBoard, formatDate, router, openRenameModal, openShareModal }) {
  const getBoardName = (board) => board.title || board.name || 'Untitled';
  const getOwnerName = (board) => board.owner?.name || board.owner?.email || 'Unknown';
  const getBoardDate = (board) => board.lastModified || board.updatedAt || board.createdAt;
  
  if (viewMode === 'list') {
    return (
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
        {boards.map((board) => (
          <div
            key={board._id}
            className="flex items-center gap-4 p-4 hover:bg-gray-50 transition-colors cursor-pointer group"
            onClick={() => router.push(`/dashboard/talioboard/${board._id}`)}
          >
            {board.thumbnail ? (
              <div className="w-16 h-12 rounded-lg overflow-hidden shadow-sm flex-shrink-0">
                <img src={board.thumbnail} alt={getBoardName(board)} className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="w-12 h-12 bg-gradient-to-br rounded-lg flex items-center justify-center text-white font-semibold text-lg shadow-sm flex-shrink-0" style={{ background: `linear-gradient(to bottom right, var(--color-primary-400), var(--color-primary-600))` }}>
                {getBoardName(board).charAt(0).toUpperCase()}
              </div>
            )}
            
            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-gray-900 truncate">{getBoardName(board)}</h3>
              <div className="flex items-center gap-3 text-sm text-gray-500 mt-0.5">
                <span className="flex items-center gap-1">
                  <FiClock size={14} />
                  {formatDate(getBoardDate(board))}
                </span>
                {!board.isOwner && board.owner && (
                  <span className="flex items-center gap-1">
                    <FiUser size={14} />
                    {getOwnerName(board)}
                  </span>
                )}
                {board.sharedWith?.length > 0 && (
                  <span className="flex items-center gap-1">
                    <FiUsers size={14} />
                    {board.sharedWith.length} collaborator{board.sharedWith.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
            
            {board.isOwner && (
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveMenu(activeMenu === board._id ? null : board._id);
                  }}
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                >
                  <FiMoreHorizontal size={18} />
                </button>
                
                {activeMenu === board._id && (
                  <BoardMenu board={board} deleteBoard={deleteBoard} setActiveMenu={setActiveMenu} openRenameModal={openRenameModal} openShareModal={openShareModal} />
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {boards.map((board) => (
        <div
          key={board._id}
          className="card card-hover cursor-pointer"
          onClick={() => router.push(`/dashboard/talioboard/${board._id}`)}
        >
          {/* Preview */}
          <div className="aspect-[4/3] relative overflow-hidden" style={{ background: 'linear-gradient(135deg, var(--color-primary-50), var(--color-primary-100))' }}>
            {board.thumbnail ? (
              <img 
                src={board.thumbnail} 
                alt={getBoardName(board)} 
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="avatar avatar-xl" style={{ borderRadius: '1rem' }}>
                  {getBoardName(board).charAt(0).toUpperCase()}
                </div>
              </div>
            )}
            
            {board.isOwner && (
              <div className="absolute top-2 right-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveMenu(activeMenu === board._id ? null : board._id);
                  }}
                  className="btn btn-ghost btn-icon btn-sm" style={{ backgroundColor: 'rgba(255,255,255,0.9)' }}
                >
                  <FiMoreHorizontal size={16} />
                </button>
                
                {activeMenu === board._id && (
                  <BoardMenu board={board} deleteBoard={deleteBoard} setActiveMenu={setActiveMenu} openRenameModal={openRenameModal} openShareModal={openShareModal} />
                )}
              </div>
            )}
            
            {!board.isOwner && (
              <div className="absolute top-2 left-2">
                <span className="badge badge-primary">Shared</span>
              </div>
            )}
          </div>
          
          {/* Info */}
          <div className="p-4">
            <h3 className="font-medium text-gray-900 truncate mb-1">{getBoardName(board)}</h3>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <FiClock size={12} />
                {formatDate(getBoardDate(board))}
              </span>
              {!board.isOwner && board.owner && (
                <span className="flex items-center gap-1">
                  <FiUser size={12} />
                  {getOwnerName(board)}
                </span>
              )}
              {board.sharedWith?.length > 0 && (
                <span className="flex items-center gap-1">
                  <FiUsers size={12} />
                  {board.sharedWith.length}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function BoardMenu({ board, deleteBoard, setActiveMenu, openRenameModal, openShareModal }) {
  return (
    <>
      <div 
        className="fixed inset-0 z-10" 
        onClick={(e) => {
          e.stopPropagation();
          setActiveMenu(null);
        }}
      />
      <div className="dropdown-menu absolute right-0 top-full mt-1">
        <button
          onClick={(e) => {
            e.stopPropagation();
            openRenameModal(board);
          }}
          className="dropdown-item"
        >
          <FiEdit2 size={15} />
          Rename
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            openShareModal(board);
          }}
          className="dropdown-item"
        >
          <FiShare2 size={15} />
          Share
        </button>
        <div className="dropdown-divider" />
        <button
          onClick={(e) => {
            e.stopPropagation();
            deleteBoard(board._id);
          }}
          className="dropdown-item dropdown-item-danger"
        >
          <FiTrash2 size={15} />
          Delete
        </button>
      </div>
    </>
  );
}
