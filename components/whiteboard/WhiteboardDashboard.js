'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Skeleton } from '@heroui/react';
import {
  HiOutlineSquares2X2,
  HiOutlinePlus,
  HiOutlineMagnifyingGlass,
  HiOutlineClock,
  HiOutlineUser,
  HiOutlineUserGroup,
  HiOutlineEllipsisVertical,
  HiOutlinePencilSquare,
  HiOutlineShare,
  HiOutlineTrash,
  HiOutlineXMark,
  HiOutlineClipboardDocument,
  HiOutlineCheckCircle,
  HiOutlineListBullet,
  HiOutlineRectangleGroup,
} from 'react-icons/hi2';
import { DataErrorState } from '@/components/ui/ErrorBoundary';
import { handleSessionExpired } from '@/utils/userHelper';

export default function WhiteboardDashboard() {
  const router = useRouter();
  const [boards, setBoards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('grid');
  const [filterView, setFilterView] = useState('all');
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

  const filteredBoards = boards.filter(board => {
    const matchesSearch = (board.title || board.name || '').toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;
    if (filterView === 'my-boards') return board.isOwner;
    if (filterView === 'shared') return !board.isOwner;
    return true;
  });

  const ownedBoards = filteredBoards.filter(b => b.isOwner);
  const sharedBoards = filteredBoards.filter(b => !b.isOwner);

  const recentBoards = [...boards]
    .sort((a, b) => new Date(b.lastModified || b.updatedAt || b.createdAt || 0) - new Date(a.lastModified || a.updatedAt || a.createdAt || 0))
    .slice(0, 5);

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <HiOutlineRectangleGroup className="w-7 h-7 text-indigo-600" />
            TalioBoard
          </h1>
          <p className="text-gray-600 mt-1">
            Collaborative whiteboards for your team
          </p>
        </div>

        <Button
          onPress={() => setShowNewBoardModal(true)}
          color="primary"
          startContent={<HiOutlinePlus className="w-5 h-5" />}
        >
          New Board
        </Button>
      </div>

      {/* Error State */}
      {error && !loading && (
        <DataErrorState
          message={error}
          onRetry={() => fetchBoards()}
          title="Error loading boards"
          className="mb-6"
        />
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <HiOutlineSquares2X2 className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{boards.length}</p>
              <p className="text-sm text-gray-500">Total Boards</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <HiOutlineUser className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{boards.filter(b => b.isOwner).length}</p>
              <p className="text-sm text-gray-500">My Boards</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-lg">
              <HiOutlineUserGroup className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{boards.filter(b => !b.isOwner).length}</p>
              <p className="text-sm text-gray-500">Shared</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <HiOutlineClock className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{recentBoards.length}</p>
              <p className="text-sm text-gray-500">Recent</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Search */}
          <div className="input-with-icon flex-1">
            <HiOutlineMagnifyingGlass className="input-icon w-5 h-5" />
            <input
              type="text"
              placeholder="Search boards..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input input-search"
            />
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <select
              value={filterView}
              onChange={(e) => setFilterView(e.target.value)}
              className="px-4 py-2.5 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="all">All Boards</option>
              <option value="my-boards">My Boards</option>
              <option value="shared">Shared with me</option>
            </select>

            {/* View Toggle */}
            <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2.5 transition-colors ${viewMode === 'grid' ? 'bg-primary-50 text-primary-600' : 'text-gray-500 hover:bg-gray-50'}`}
              >
                <HiOutlineSquares2X2 className="w-5 h-5" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-2.5 transition-colors ${viewMode === 'list' ? 'bg-primary-50 text-primary-600' : 'text-gray-500 hover:bg-gray-50'}`}
              >
                <HiOutlineListBullet className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <Skeleton className="w-full aspect-[4/3] rounded-none" />
                <div className="p-4 space-y-2">
                  <Skeleton className="h-4 w-3/4 rounded" />
                  <Skeleton className="h-3 w-1/2 rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : !error && filteredBoards.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl shadow-sm border border-gray-100">
          <HiOutlineRectangleGroup className="w-16 h-16 mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-800 mb-2">
            {searchQuery ? 'No boards found' : 'No boards yet'}
          </h3>
          <p className="text-gray-500 mb-6">
            {searchQuery ? 'Try adjusting your search or filter' : 'Create your first whiteboard to start collaborating'}
          </p>
          {!searchQuery && (
            <Button
              onPress={() => setShowNewBoardModal(true)}
              color="primary"
              startContent={<HiOutlinePlus className="w-5 h-5" />}
            >
              Create Board
            </Button>
          )}
        </div>
      ) : !error && (
        <div className="space-y-8">
          {/* My Boards Section */}
          {ownedBoards.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <HiOutlineUser className="w-5 h-5 text-green-500" />
                My Boards ({ownedBoards.length})
              </h2>
              <BoardGrid
                boards={ownedBoards}
                viewMode={viewMode}
                activeMenu={activeMenu}
                setActiveMenu={setActiveMenu}
                deleteBoard={deleteBoard}
                formatDate={formatDate}
                router={router}
                openRenameModal={openRenameModal}
                openShareModal={openShareModal}
              />
            </div>
          )}

          {/* Shared Boards Section */}
          {sharedBoards.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <HiOutlineUserGroup className="w-5 h-5 text-amber-500" />
                Shared with me ({sharedBoards.length})
              </h2>
              <BoardGrid
                boards={sharedBoards}
                viewMode={viewMode}
                activeMenu={activeMenu}
                setActiveMenu={setActiveMenu}
                deleteBoard={deleteBoard}
                formatDate={formatDate}
                router={router}
                openRenameModal={openRenameModal}
                openShareModal={openShareModal}
              />
            </div>
          )}
        </div>
      )}

      {/* New Board Modal */}
      {showNewBoardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => { setShowNewBoardModal(false); setNewBoardName(''); }}>
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 pb-0">
              <h2 className="text-lg font-semibold text-gray-900">Create new board</h2>
              <button onClick={() => { setShowNewBoardModal(false); setNewBoardName(''); }} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                <HiOutlineXMark className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              <p className="text-sm text-gray-500 mb-4">Give your board a name to get started</p>
              <input
                type="text"
                placeholder="Board name"
                value={newBoardName}
                onChange={(e) => setNewBoardName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createBoard()}
                autoFocus
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
              />
            </div>

            <div className="flex items-center justify-end gap-3 px-6 pb-6">
              <Button
                variant="light"
                onPress={() => { setShowNewBoardModal(false); setNewBoardName(''); }}
              >
                Cancel
              </Button>
              <Button
                color="primary"
                onPress={createBoard}
                isDisabled={!newBoardName.trim() || creating}
                isLoading={creating}
              >
                Create board
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {showRenameModal && renameBoard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowRenameModal(false)}>
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 pb-0">
              <h2 className="text-lg font-semibold text-gray-900">Rename board</h2>
              <button onClick={() => setShowRenameModal(false)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                <HiOutlineXMark className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              <input
                type="text"
                placeholder="Board name"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                autoFocus
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
              />
            </div>

            <div className="flex items-center justify-end gap-3 px-6 pb-6">
              <Button variant="light" onPress={() => setShowRenameModal(false)}>
                Cancel
              </Button>
              <Button
                color="primary"
                onPress={handleRename}
                isDisabled={!newTitle.trim() || renaming}
                isLoading={renaming}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {showShareModal && shareBoard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowShareModal(false)}>
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 pb-0">
              <h2 className="text-lg font-semibold text-gray-900">Share board</h2>
              <button onClick={() => setShowShareModal(false)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                <HiOutlineXMark className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              <p className="text-gray-600 mb-4">
                Share &ldquo;{shareBoard.title || shareBoard.name}&rdquo; with others
              </p>

              <div className="flex gap-2">
                <div className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-600 text-sm truncate font-mono">
                  {typeof window !== 'undefined' ? `${window.location.origin}/dashboard/talioboard/${shareBoard._id}` : ''}
                </div>
                <Button
                  color={copied ? 'success' : 'primary'}
                  onPress={copyShareLink}
                  startContent={copied ? <HiOutlineCheckCircle className="w-5 h-5" /> : <HiOutlineClipboardDocument className="w-5 h-5" />}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </Button>
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
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm divide-y divide-gray-100 overflow-hidden">
        {boards.map((board) => (
          <div
            key={board._id}
            className="flex items-center gap-4 p-4 hover:bg-gray-50 transition-colors cursor-pointer group"
            onClick={() => router.push(`/dashboard/talioboard/${board._id}`)}
          >
            {board.thumbnail ? (
              <div className="w-16 h-12 rounded-lg overflow-hidden shadow-sm flex-shrink-0 border border-gray-100">
                <img src={board.thumbnail} alt={getBoardName(board)} className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center text-white font-semibold text-lg shadow-sm flex-shrink-0">
                {getBoardName(board).charAt(0).toUpperCase()}
              </div>
            )}

            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-gray-900 truncate">{getBoardName(board)}</h3>
              <div className="flex items-center gap-3 text-sm text-gray-500 mt-0.5">
                <span className="flex items-center gap-1">
                  <HiOutlineClock className="w-3.5 h-3.5" />
                  {formatDate(getBoardDate(board))}
                </span>
                {!board.isOwner && board.owner && (
                  <span className="flex items-center gap-1">
                    <HiOutlineUser className="w-3.5 h-3.5" />
                    {getOwnerName(board)}
                  </span>
                )}
                {board.sharedWith?.length > 0 && (
                  <span className="flex items-center gap-1">
                    <HiOutlineUserGroup className="w-3.5 h-3.5" />
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
                  <HiOutlineEllipsisVertical className="w-5 h-5" />
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
          className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md hover:border-gray-200 transition-all cursor-pointer group"
          onClick={() => router.push(`/dashboard/talioboard/${board._id}`)}
        >
          {/* Preview */}
          <div className="aspect-[4/3] relative overflow-hidden bg-gradient-to-br from-gray-50 to-gray-100">
            {board.thumbnail ? (
              <img
                src={board.thumbnail}
                alt={getBoardName(board)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center text-white font-bold text-2xl shadow-lg">
                  {getBoardName(board).charAt(0).toUpperCase()}
                </div>
              </div>
            )}

            {board.isOwner && (
              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveMenu(activeMenu === board._id ? null : board._id);
                  }}
                  className="p-1.5 bg-white/90 hover:bg-white text-gray-600 rounded-lg shadow-sm transition-colors"
                >
                  <HiOutlineEllipsisVertical className="w-4 h-4" />
                </button>

                {activeMenu === board._id && (
                  <BoardMenu board={board} deleteBoard={deleteBoard} setActiveMenu={setActiveMenu} openRenameModal={openRenameModal} openShareModal={openShareModal} />
                )}
              </div>
            )}

            {!board.isOwner && (
              <div className="absolute top-2 left-2">
                <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-700 text-xs font-medium rounded-md">
                  <HiOutlineUserGroup className="w-3 h-3" />
                  Shared
                </span>
              </div>
            )}
          </div>

          {/* Info */}
          <div className="p-4">
            <h3 className="font-medium text-gray-900 truncate mb-1">{getBoardName(board)}</h3>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <HiOutlineClock className="w-3 h-3" />
                {formatDate(getBoardDate(board))}
              </span>
              {!board.isOwner && board.owner && (
                <span className="flex items-center gap-1">
                  <HiOutlineUser className="w-3 h-3" />
                  {getOwnerName(board)}
                </span>
              )}
              {board.sharedWith?.length > 0 && (
                <span className="flex items-center gap-1">
                  <HiOutlineUserGroup className="w-3 h-3" />
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
      <div className="absolute right-0 top-full mt-1 z-20 bg-white rounded-xl shadow-lg border border-gray-200 py-1.5 min-w-[160px]">
        <button
          onClick={(e) => {
            e.stopPropagation();
            openRenameModal(board);
          }}
          className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <HiOutlinePencilSquare className="w-4 h-4" />
          Rename
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            openShareModal(board);
          }}
          className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <HiOutlineShare className="w-4 h-4" />
          Share
        </button>
        <div className="my-1.5 border-t border-gray-100" />
        <button
          onClick={(e) => {
            e.stopPropagation();
            deleteBoard(board._id);
          }}
          className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
        >
          <HiOutlineTrash className="w-4 h-4" />
          Delete
        </button>
      </div>
    </>
  );
}
