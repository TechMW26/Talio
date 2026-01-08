'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAILoading } from '@/contexts/AILoadingContext';
import {
  FaInbox, FaPaperPlane, FaFile, FaTrash, FaStar, FaSearch,
  FaTimes, FaEnvelope, FaReply,
  FaForward, FaPaperclip, FaChevronLeft,
  FaRegStar,
  FaRegEnvelope, FaRegEnvelopeOpen, FaAngleLeft, FaAngleRight,
  FaExpandAlt, FaCompressAlt, FaMinus, FaBold, FaItalic,
  FaUnderline, FaListUl, FaListOl, FaQuoteRight, FaStrikethrough,
  FaLink, FaSmile, FaChevronDown, FaChevronRight, FaMagic
} from 'react-icons/fa';
import Loader from '@/components/ui/Loader';
import {
  MdRefresh, MdMoreVert, MdArchive, MdDelete,
  MdSchedule, MdCheckBoxOutlineBlank, MdKeyboardArrowDown,
  MdStar, MdStarBorder, MdLabelImportant, MdAttachFile, MdClose,
  MdSend, MdInsertLink,
  MdInsertEmoticon, MdArrowDropDown, MdInbox,
  MdOutlineDrafts, MdOutlineSend, MdLabel, MdMoveToInbox,
  MdAccessTime, MdLabelImportantOutline, MdAllInbox,
  MdReportGmailerrorred, MdCategory, MdSettings,
  MdCheckBox, MdIndeterminateCheckBox, MdReport, MdAdd,
  MdLabelOff, MdFilterList, MdPrint
} from 'react-icons/md';
import { HiOutlinePencilAlt } from 'react-icons/hi';

// Primary folders
const primaryFolders = [
  { id: 'inbox', name: 'Inbox', icon: MdInbox },
  { id: 'starred', name: 'Starred', icon: MdStarBorder },
  { id: 'snoozed', name: 'Snoozed', icon: MdAccessTime },
  { id: 'sent', name: 'Sent', icon: MdOutlineSend },
  { id: 'drafts', name: 'Drafts', icon: MdOutlineDrafts },
];

// Secondary folders (shown under "More")
const secondaryFolders = [
  { id: 'important', name: 'Important', icon: MdLabelImportantOutline },
  { id: 'all', name: 'All Mail', icon: MdAllInbox },
  { id: 'spam', name: 'Spam', icon: MdReportGmailerrorred },
  { id: 'trash', name: 'Trash', icon: MdDelete },
];

// Common emojis for quick access
const commonEmojis = [
  '😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂',
  '😉', '😍', '🥰', '😘', '😋', '😛', '🤔', '🤗', '😎', '🥳',
  '😴', '🙄', '😬', '😱', '👋', '👍', '👎', '👏', '🙏', '🤝',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💯', '✅', '❌',
  '⭐', '🔥', '✨', '💡', '📧', '📎', '📅', '⏰', '🎉', '🎊'
];

export default function MailPage() {
  const [isConnected, setIsConnected] = useState(false);
  const [connectedEmail, setConnectedEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [connectingEmail, setConnectingEmail] = useState(false);
  const [emails, setEmails] = useState([]);
  const [isDesktopApp, setIsDesktopApp] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState('inbox');
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [spamCount, setSpamCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCompose, setShowCompose] = useState(false);
  const [composeMinimized, setComposeMinimized] = useState(false);
  const [composeFullscreen, setComposeFullscreen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pageToken, setPageToken] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingEmails, setLoadingEmails] = useState(false);
  const [showSearchFocused, setShowSearchFocused] = useState(false);
  const [error, setError] = useState(null);
  const [showMoreFolders, setShowMoreFolders] = useState(false);

  // AI Compose State
  const [showAiCompose, setShowAiCompose] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiTone, setAiTone] = useState('professional');
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  
  // Global AI loading animation
  const { startAILoading, stopAILoading } = useAILoading();

  // Multi-account support
  const [accounts, setAccounts] = useState([]);
  const [activeAccountId, setActiveAccountId] = useState(null);
  const [showAccountSwitcher, setShowAccountSwitcher] = useState(false);
  const [showAllAccounts, setShowAllAccounts] = useState(false);

  // Labels and Categories
  const [showCategoriesModal, setShowCategoriesModal] = useState(false);
  const [showLabelsModal, setShowLabelsModal] = useState(false);
  const [userLabels, setUserLabels] = useState([]);
  const [folderCounts, setFolderCounts] = useState({
    inbox: { total: 0, unread: 0 },
    sent: { total: 0, unread: 0 },
    drafts: { total: 0, unread: 0 },
    trash: { total: 0, unread: 0 },
    spam: { total: 0, unread: 0 },
    starred: { total: 0, unread: 0 },
    important: { total: 0, unread: 0 },
    snoozed: { total: 0, unread: 0 },
  });
  const [showSnoozeModal, setShowSnoozeModal] = useState(false);
  const [snoozeEmail, setSnoozeEmailState] = useState(null);

  // Email selection state
  const [selectedEmails, setSelectedEmails] = useState(new Set());

  // Detail view toolbar dropdown menus
  const [showMoveToMenu, setShowMoveToMenu] = useState(false);
  const [showLabelsMenu, setShowLabelsMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  // Compose email state
  const [composeData, setComposeData] = useState({
    to: '',
    cc: '',
    bcc: '',
    subject: '',
    body: '',
    isHtml: true
  });
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showFormattingToolbar, setShowFormattingToolbar] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  // Refs
  const fileInputRef = useRef(null);
  const bodyEditorRef = useRef(null);

  const getToken = () => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('token');
    }
    return null;
  };

  // Check email connection status
  const checkConnectionStatus = useCallback(async () => {
    try {
      const token = getToken();
      const res = await fetch('/api/mail', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();

      setIsConnected(data.isConnected || false);
      setConnectedEmail(data.email || '');
      setUnreadCount(data.unreadCount || 0);
      setSpamCount(data.spamCount || 0);
      setAccounts(data.accounts || []);
      setActiveAccountId(data.activeAccountId || null);
    } catch (err) {
      console.error('Error checking email status:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch emails
  const fetchEmails = useCallback(async (folder = 'inbox', reset = false) => {
    if (loadingEmails || (!reset && !hasMore)) return;

    try {
      setLoadingEmails(true);
      setError(null);
      const token = getToken();
      const params = new URLSearchParams({
        folder,
        maxResults: '50',
        ...(pageToken && !reset ? { pageToken } : {}),
        ...(showAllAccounts ? { allAccounts: 'true' } : {}),
        ...(activeAccountId && !showAllAccounts ? { accountId: activeAccountId } : {})
      });

      const res = await fetch(`/api/mail/messages?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) {
        if (res.status === 401) {
          setIsConnected(false);
          return;
        }
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to fetch emails');
      }

      const data = await res.json();

      if (reset) {
        setEmails(data.emails || []);
      } else {
        setEmails(prev => [...prev, ...(data.emails || [])]);
      }

      setPageToken(data.nextPageToken || null);
      setHasMore(!!data.nextPageToken);
      setUnreadCount(data.unreadCount || 0);
      if (data.spamCount !== undefined) {
        setSpamCount(data.spamCount);
      }
    } catch (err) {
      console.error('Error fetching emails:', err);
      setError(err.message);
    } finally {
      setLoadingEmails(false);
      setSyncing(false);
    }
  }, [loadingEmails, hasMore, pageToken, showAllAccounts, activeAccountId]);

  // Switch account
  const switchAccount = (accountId) => {
    setActiveAccountId(accountId);
    setShowAllAccounts(false);
    setShowAccountSwitcher(false);
    setPageToken(null);
    setHasMore(true);
    setEmails([]);

    // Update connected email display
    const account = accounts.find(a => a.id === accountId);
    if (account) {
      setConnectedEmail(account.email);
    }
  };

  // View all accounts' emails
  const viewAllAccountsEmails = () => {
    setShowAllAccounts(true);
    setShowAccountSwitcher(false);
    setPageToken(null);
    setHasMore(true);
    setEmails([]);
  };

  // Connect email (initiate OAuth)
  const connectEmail = async () => {
    try {
      setConnectingEmail(true);
      const token = getToken();
      const res = await fetch('/api/mail', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();

      if (data.authUrl) {
        window.location.href = data.authUrl;
      }
    } catch (err) {
      console.error('Error connecting email:', err);
      alert('Failed to initiate email connection');
    } finally {
      setConnectingEmail(false);
    }
  };

  // Disconnect email
  const disconnectEmail = async () => {
    if (!confirm('Are you sure you want to disconnect your email?')) return;

    try {
      const token = getToken();
      await fetch('/api/mail', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      setIsConnected(false);
      setConnectedEmail('');
      setEmails([]);
      setSelectedEmail(null);
    } catch (err) {
      console.error('Error disconnecting email:', err);
    }
  };

  // AI Compose Handler
  const handleAiCompose = async () => {
    if (!aiPrompt.trim()) return;

    setIsGeneratingAi(true);
    startAILoading('MIRA is composing your email...');
    try {
      const token = localStorage.getItem('token');
      
      // Determine if this is a reply
      const isReply = composeData.subject?.startsWith('Re:') || (selectedEmail && composeData.subject?.includes(selectedEmail.subject));
      const context = isReply && selectedEmail ? `From: ${selectedEmail.from?.name} <${selectedEmail.from?.email}>\nSubject: ${selectedEmail.subject}\n\n${selectedEmail.body || selectedEmail.snippet}` : '';

      const response = await fetch('/api/mail/compose-ai', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: aiPrompt,
          tone: aiTone,
          type: isReply ? 'reply' : 'compose',
          context: context
        })
      });

      const data = await response.json();
      if (data.success) {
        setComposeData(prev => ({
          ...prev,
          body: prev.body ? prev.body + '<br><br>' + data.content : data.content
        }));
        setShowAiCompose(false);
        setAiPrompt('');
      } else {
        console.error('AI generation failed:', data.error);
      }
    } catch (error) {
      console.error('AI generation error:', error);
    } finally {
      setIsGeneratingAi(false);
      stopAILoading();
    }
  };

  // Send email
  const sendEmail = async () => {
    if (!composeData.to || !composeData.subject) {
      alert('Please fill in To and Subject fields');
      return;
    }

    try {
      setSending(true);
      const token = getToken();

      // Get the body content from the contentEditable div if it exists
      const bodyContent = bodyEditorRef.current ? bodyEditorRef.current.innerHTML : composeData.body;

      const res = await fetch('/api/mail/messages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          to: composeData.to,
          cc: composeData.cc || undefined,
          bcc: composeData.bcc || undefined,
          subject: composeData.subject,
          body: bodyContent,
          isHtml: true,
          attachments: attachments.map(a => ({
            filename: a.name,
            content: a.base64,
            contentType: a.type
          }))
        })
      });

      if (!res.ok) throw new Error('Failed to send email');

      setShowCompose(false);
      setComposeData({ to: '', cc: '', bcc: '', subject: '', body: '', isHtml: true });
      setShowCcBcc(false);
      setAttachments([]);
      setShowEmojiPicker(false);
      setShowFormattingToolbar(false);

      if (selectedFolder === 'sent') {
        setPageToken(null);
        setHasMore(true);
        fetchEmails('sent', true);
      }

      alert('Email sent successfully!');
    } catch (err) {
      console.error('Error sending email:', err);
      alert('Failed to send email');
    } finally {
      setSending(false);
    }
  };

  // Handle file attachment
  const handleFileAttachment = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setUploadingAttachment(true);

    try {
      const newAttachments = await Promise.all(files.map(async (file) => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = reader.result.split(',')[1];
            resolve({
              name: file.name,
              size: file.size,
              type: file.type,
              base64: base64
            });
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }));

      setAttachments(prev => [...prev, ...newAttachments]);
    } catch (err) {
      console.error('Error reading file:', err);
      alert('Failed to attach file');
    } finally {
      setUploadingAttachment(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Remove attachment
  const removeAttachment = (index) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  // Insert emoji into body
  const insertEmoji = (emoji) => {
    if (bodyEditorRef.current) {
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        if (bodyEditorRef.current.contains(range.commonAncestorContainer)) {
          range.deleteContents();
          range.insertNode(document.createTextNode(emoji));
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
          setShowEmojiPicker(false);
          return;
        }
      }
      // If not in editor, append to end
      bodyEditorRef.current.innerHTML += emoji;
    }
    setShowEmojiPicker(false);
  };

  // Apply text formatting
  const applyFormatting = (command, value = null) => {
    document.execCommand(command, false, value);
    if (bodyEditorRef.current) {
      bodyEditorRef.current.focus();
    }
  };

  // Insert link
  const insertLink = () => {
    const url = prompt('Enter URL:');
    if (url) {
      applyFormatting('createLink', url);
    }
  };

  // Format file size
  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Toggle star
  const toggleStar = async (email, e) => {
    e?.stopPropagation();
    setShowMoreMenu(false);
    try {
      const token = getToken();
      const wasStarred = email.isStarred;

      await fetch('/api/mail/messages', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messageId: email.messageId,
          action: wasStarred ? 'unstar' : 'star'
        })
      });

      // If in starred folder and unstarring, remove from list
      if (selectedFolder === 'starred' && wasStarred) {
        setEmails(prev => prev.filter(e => e.messageId !== email.messageId));
        if (selectedEmail?.messageId === email.messageId) {
          setSelectedEmail(null);
        }
      } else {
        setEmails(prev => prev.map(e =>
          e.messageId === email.messageId ? { ...e, isStarred: !e.isStarred } : e
        ));

        // Update selectedEmail if it's the one being modified
        if (selectedEmail?.messageId === email.messageId) {
          setSelectedEmail(prev => ({ ...prev, isStarred: !prev.isStarred }));
        }
      }
    } catch (err) {
      console.error('Error toggling star:', err);
    }
  };

  // Archive email
  const archiveEmail = async (email, e) => {
    e?.stopPropagation();
    setShowMoveToMenu(false);
    try {
      const token = getToken();
      await fetch('/api/mail/messages', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messageId: email.messageId,
          action: 'archive'
        })
      });

      setEmails(prev => prev.filter(e => e.messageId !== email.messageId));
      if (selectedEmail?.messageId === email.messageId) {
        setSelectedEmail(null);
      }
    } catch (err) {
      console.error('Error archiving email:', err);
    }
  };

  // Delete email
  const deleteEmail = async (email, e) => {
    e?.stopPropagation();
    setShowMoveToMenu(false);
    try {
      const token = getToken();
      await fetch('/api/mail/messages', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messageId: email.messageId,
          action: selectedFolder === 'trash' ? 'untrash' : 'trash'
        })
      });

      setEmails(prev => prev.filter(e => e.messageId !== email.messageId));
      if (selectedEmail?.messageId === email.messageId) {
        setSelectedEmail(null);
      }
    } catch (err) {
      console.error('Error deleting email:', err);
    }
  };

  // Mark as read/unread
  const toggleRead = async (email, e) => {
    e?.stopPropagation();
    setShowMoreMenu(false);
    try {
      const token = getToken();
      await fetch('/api/mail/messages', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messageId: email.messageId,
          action: email.isRead ? 'markUnread' : 'markRead'
        })
      });

      setEmails(prev => prev.map(e =>
        e.messageId === email.messageId ? { ...e, isRead: !e.isRead } : e
      ));

      // Update selectedEmail if it's the one being modified
      if (selectedEmail?.messageId === email.messageId) {
        setSelectedEmail(prev => ({ ...prev, isRead: !prev.isRead }));
      }

      if (!email.isRead) {
        setUnreadCount(prev => Math.max(0, prev - 1));
      } else {
        setUnreadCount(prev => prev + 1);
      }
    } catch (err) {
      console.error('Error toggling read status:', err);
    }
  };

  // Snooze/Unsnooze email
  const handleSnoozeEmail = async (email, e) => {
    e?.stopPropagation();
    setShowMoreMenu(false);

    try {
      const token = getToken();
      // If viewing snoozed folder, unsnooze (move back to inbox)
      // Otherwise, snooze the email
      const isSnoozed = selectedFolder === 'snoozed';
      const action = isSnoozed ? 'unsnooze' : 'snooze';

      await fetch('/api/mail/messages', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messageId: email.messageId,
          action
        })
      });

      // Remove email from current view
      setEmails(prev => prev.filter(e => e.messageId !== email.messageId));
      if (selectedEmail?.messageId === email.messageId) {
        setSelectedEmail(null);
      }

      // Update folder counts
      if (isSnoozed) {
        // Moving from snoozed to inbox
        setFolderCounts(prev => ({
          ...prev,
          inbox: { ...prev.inbox, total: prev.inbox.total + 1 },
          snoozed: { ...prev.snoozed, total: Math.max(0, prev.snoozed.total - 1) }
        }));
      } else {
        // Moving from current folder to snoozed
        setFolderCounts(prev => ({
          ...prev,
          inbox: { ...prev.inbox, total: Math.max(0, prev.inbox.total - 1) },
          snoozed: { ...prev.snoozed, total: prev.snoozed.total + 1 }
        }));
      }
    } catch (err) {
      console.error('Error snoozing/unsnoozing email:', err);
    }
  };

  // Move email to folder
  const moveToFolder = async (email, targetFolder, e) => {
    e?.stopPropagation();
    setShowMoveToMenu(false);

    try {
      const token = getToken();
      let action = '';

      switch (targetFolder) {
        case 'inbox':
          action = 'untrash'; // Move back to inbox
          break;
        case 'trash':
          action = 'trash';
          break;
        case 'archive':
          action = 'archive';
          break;
        case 'spam':
          action = 'spam';
          break;
        default:
          return;
      }

      await fetch('/api/mail/messages', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messageId: email.messageId,
          action
        })
      });

      setEmails(prev => prev.filter(e => e.messageId !== email.messageId));
      if (selectedEmail?.messageId === email.messageId) {
        setSelectedEmail(null);
      }
    } catch (err) {
      console.error('Error moving email:', err);
    }
  };

  // Mark email as important/not important
  const toggleImportant = async (email, e) => {
    e?.stopPropagation();
    setShowMoreMenu(false);

    try {
      const token = getToken();
      const isImportant = email.labels?.includes('IMPORTANT');

      await fetch('/api/mail/messages', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messageId: email.messageId,
          action: isImportant ? 'unmarkImportant' : 'markImportant'
        })
      });

      // If in important folder and unmarking, remove from list
      if (selectedFolder === 'important' && isImportant) {
        setEmails(prev => prev.filter(e => e.messageId !== email.messageId));
        if (selectedEmail?.messageId === email.messageId) {
          setSelectedEmail(null);
        }
      } else {
        setEmails(prev => prev.map(e => {
          if (e.messageId === email.messageId) {
            const newLabels = isImportant
              ? (e.labels || []).filter(l => l !== 'IMPORTANT')
              : [...(e.labels || []), 'IMPORTANT'];
            return { ...e, labels: newLabels };
          }
          return e;
        }));

        // Update selectedEmail if it's the one being modified
        if (selectedEmail?.messageId === email.messageId) {
          setSelectedEmail(prev => {
            const newLabels = isImportant
              ? (prev.labels || []).filter(l => l !== 'IMPORTANT')
              : [...(prev.labels || []), 'IMPORTANT'];
            return { ...prev, labels: newLabels };
          });
        }
      }
    } catch (err) {
      console.error('Error toggling important:', err);
    }
  };

  // Report email as spam
  const reportSpam = async (email, e) => {
    e?.stopPropagation();
    setShowMoreMenu(false);

    try {
      const token = getToken();
      await fetch('/api/mail/messages', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messageId: email.messageId,
          action: 'spam'
        })
      });

      setEmails(prev => prev.filter(e => e.messageId !== email.messageId));
      if (selectedEmail?.messageId === email.messageId) {
        setSelectedEmail(null);
      }
    } catch (err) {
      console.error('Error reporting spam:', err);
    }
  };

  // Fetch labels with counts
  const fetchLabels = useCallback(async () => {
    try {
      const token = getToken();
      const res = await fetch('/api/mail/labels', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) return;

      const data = await res.json();

      if (data.folderCounts) {
        setFolderCounts(data.folderCounts);
        // Update unread and spam counts
        setUnreadCount(data.folderCounts.inbox?.unread || 0);
        setSpamCount(data.folderCounts.spam?.total || 0);
      }

      if (data.userLabels) {
        setUserLabels(data.userLabels);
      }
    } catch (err) {
      console.error('Error fetching labels:', err);
    }
  }, []);

  // Email selection handlers
  const toggleEmailSelection = (email, e) => {
    e?.stopPropagation();
    setSelectedEmails(prev => {
      const newSet = new Set(prev);
      if (newSet.has(email.messageId)) {
        newSet.delete(email.messageId);
      } else {
        newSet.add(email.messageId);
      }
      return newSet;
    });
  };

  // Helper function to get filtered emails
  const getFilteredEmails = useCallback(() => {
    return emails.filter(email => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      return (
        email.subject?.toLowerCase().includes(query) ||
        email.from?.name?.toLowerCase().includes(query) ||
        email.from?.email?.toLowerCase().includes(query) ||
        email.snippet?.toLowerCase().includes(query)
      );
    });
  }, [emails, searchQuery]);

  const selectAllEmails = useCallback(() => {
    const filtered = getFilteredEmails();
    const allIds = new Set(filtered.map(e => e.messageId));
    setSelectedEmails(allIds);
  }, [getFilteredEmails]);

  const selectNone = useCallback(() => {
    setSelectedEmails(new Set());
  }, []);

  // Bulk actions on selected emails
  const bulkArchive = async () => {
    if (selectedEmails.size === 0) return;
    const token = getToken();

    for (const messageId of selectedEmails) {
      try {
        await fetch('/api/mail/messages', {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ messageId, action: 'archive' })
        });
      } catch (err) {
        console.error('Error archiving email:', err);
      }
    }

    setEmails(prev => prev.filter(e => !selectedEmails.has(e.messageId)));
    setSelectedEmails(new Set());
  };

  const bulkDelete = async () => {
    if (selectedEmails.size === 0) return;
    const token = getToken();
    const action = selectedFolder === 'trash' ? 'untrash' : 'trash';

    for (const messageId of selectedEmails) {
      try {
        await fetch('/api/mail/messages', {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ messageId, action })
        });
      } catch (err) {
        console.error('Error deleting email:', err);
      }
    }

    setEmails(prev => prev.filter(e => !selectedEmails.has(e.messageId)));
    setSelectedEmails(new Set());
  };

  const bulkMarkRead = async () => {
    if (selectedEmails.size === 0) return;
    const token = getToken();

    for (const messageId of selectedEmails) {
      try {
        await fetch('/api/mail/messages', {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ messageId, action: 'markRead' })
        });
      } catch (err) {
        console.error('Error marking email as read:', err);
      }
    }

    setEmails(prev => prev.map(e =>
      selectedEmails.has(e.messageId) ? { ...e, isRead: true } : e
    ));
    setSelectedEmails(new Set());
  };

  const bulkMarkUnread = async () => {
    if (selectedEmails.size === 0) return;
    const token = getToken();

    for (const messageId of selectedEmails) {
      try {
        await fetch('/api/mail/messages', {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ messageId, action: 'markUnread' })
        });
      } catch (err) {
        console.error('Error marking email as unread:', err);
      }
    }

    setEmails(prev => prev.map(e =>
      selectedEmails.has(e.messageId) ? { ...e, isRead: false } : e
    ));
    setSelectedEmails(new Set());
  };

  // Sync emails
  const syncEmails = () => {
    setSyncing(true);
    setPageToken(null);
    setHasMore(true);
    fetchEmails(selectedFolder, true);
  };

  // Handle folder change
  const handleFolderChange = (folderId) => {
    setSelectedFolder(folderId);
    setSelectedEmail(null);
    setSelectedEmails(new Set()); // Clear selections when changing folders
    setPageToken(null);
    setHasMore(true);
    setEmails([]);
    setError(null);
    fetchEmails(folderId, true);
  };

  // Format date Gmail style
  const formatDate = (date) => {
    const d = new Date(date);
    const now = new Date();
    const diff = now - d;

    if (diff < 86400000 && d.getDate() === now.getDate()) {
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    }
    if (d.getFullYear() === now.getFullYear()) {
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Get sender avatar color
  const getSenderAvatar = (from) => {
    const name = from?.name || from?.email || '?';
    const initial = name[0].toUpperCase();
    const colors = [
      '#1a73e8', '#ea4335', '#fbbc04', '#34a853', '#673ab7',
      '#e91e63', '#00bcd4', '#ff5722', '#795548', '#607d8b'
    ];
    const colorIndex = name.charCodeAt(0) % colors.length;
    return { initial, color: colors[colorIndex] };
  };

  // Check for connection status on mount
  useEffect(() => {
    // Detect if running in desktop app (Electron)
    // The desktop app's preload.js exposes window.isElectron = true
    if (typeof window !== 'undefined' && window.isElectron) {
      setIsDesktopApp(true);
    }

    checkConnectionStatus();

    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const urlError = params.get('error');

    if (connected === 'true') {
      setIsConnected(true);
      window.history.replaceState({}, '', '/dashboard/mail');
    }

    if (urlError) {
      alert(`Failed to connect email: ${urlError}`);
      window.history.replaceState({}, '', '/dashboard/mail');
    }
  }, [checkConnectionStatus]);

  // Fetch emails when connected or when account/view changes
  useEffect(() => {
    if (isConnected && !loading) {
      fetchEmails(selectedFolder, true);
      fetchLabels(); // Fetch label counts
    }
  }, [isConnected, loading, selectedFolder, showAllAccounts, activeAccountId, fetchLabels]);

  // Close dropdowns on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      // Close dropdown menus when clicking outside
      if (!e.target.closest('[data-dropdown]')) {
        setShowMoveToMenu(false);
        setShowLabelsMenu(false);
        setShowMoreMenu(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // Filter emails (using same logic as getFilteredEmails for consistency)
  const filteredEmails = getFilteredEmails();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-120px)] bg-white">
        <Loader size="lg" />
      </div>
    );
  }

  // Not connected - Gmail style connect screen
  if (!isConnected) {
    // Desktop app users need to connect via web browser (OAuth redirect doesn't work in Electron)
    if (isDesktopApp) {
      return (
        <div className="flex flex-col items-center justify-center h-[calc(100vh-120px)] bg-[#f6f8fc]">
          <div className="text-center max-w-md px-4">
            <div className="mb-8">
              <div className="w-24 h-24 mx-auto relative">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500 via-purple-500 to-indigo-500 rounded-2xl opacity-20"></div>
                <div className="absolute inset-2 bg-white rounded-xl flex items-center justify-center">
                  <FaEnvelope className="text-4xl text-blue-500" />
                </div>
              </div>
            </div>

            <h1 className="text-3xl font-normal text-gray-800 mb-2">
              Connect Your Email
            </h1>
            <p className="text-gray-600 mb-4 text-base">
              To connect your Gmail account, you need to sign in through your web browser.
            </p>
            <p className="text-gray-500 mb-8 text-sm">
              This is required for secure Google authentication. Once connected, you can access your emails here in the desktop app.
            </p>

            <button
              onClick={() => {
                // This will be intercepted by Electron's setWindowOpenHandler and opened in external browser
                window.open('https://app.talio.in/dashboard/mail', '_blank');
              }}
              className="inline-flex items-center gap-3 bg-blue-600 text-white px-8 py-3 rounded-full font-medium hover:bg-blue-700 hover:shadow-lg transition-all text-base"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Open in Browser to Connect
            </button>

            <p className="text-xs text-gray-500 mt-6">
              After connecting in your browser, return here and refresh the page to access your emails.
            </p>

            <button
              onClick={() => {
                setLoading(true);
                checkConnectionStatus();
              }}
              className="mt-4 text-blue-600 hover:text-blue-700 text-sm font-medium hover:underline"
            >
              I've connected my email - Refresh
            </button>
          </div>
        </div>
      );
    }

    // Regular web browser - show normal connect screen
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-120px)] bg-[#f6f8fc]">
        <div className="text-center max-w-md">
          <div className="mb-8">
            <div className="w-24 h-24 mx-auto relative">
              <div className="absolute inset-0 bg-gradient-to-br from-red-500 via-yellow-500 to-green-500 rounded-2xl opacity-20"></div>
              <div className="absolute inset-2 bg-white rounded-xl flex items-center justify-center">
                <FaEnvelope className="text-4xl text-red-500" />
              </div>
            </div>
          </div>

          <h1 className="text-3xl font-normal text-gray-800 mb-2">
            Welcome to Mail
          </h1>
          <p className="text-gray-600 mb-8 text-base">
            Connect your Gmail account to access your emails directly from Talio
          </p>

          <button
            onClick={connectEmail}
            disabled={connectingEmail}
            className="inline-flex items-center gap-3 bg-white border border-gray-300 text-gray-700 px-8 py-3 rounded-full font-medium hover:bg-gray-50 hover:shadow-md transition-all disabled:opacity-50 text-base"
          >
            {connectingEmail ? (
              <Loader size="xs" />
            ) : (
              <>
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Sign in with Google
              </>
            )}
          </button>

          <p className="text-xs text-gray-500 mt-6">
            We'll only access your emails with your permission.<br />
            You can disconnect at any time.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-80px)] flex flex-col bg-white -m-4 md:-m-6">
      {/* Gmail Style Header/Search Bar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-[#f6f8fc] border-b border-gray-200">
        <div className={`flex-1 max-w-3xl mx-auto transition-all ${showSearchFocused ? 'shadow-lg' : ''}`}>
          <div className={`flex items-center rounded-full px-4 py-2.5 transition-all ${showSearchFocused ? 'bg-white shadow-md' : 'bg-[#eaf1fb] hover:bg-[#dde3ea] hover:shadow-sm'}`}>
            <FaSearch className="text-gray-500 mr-3" />
            <input
              type="text"
              placeholder="Search mail"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setShowSearchFocused(true)}
              onBlur={() => setShowSearchFocused(false)}
              className="flex-1 bg-transparent focus:outline-none text-gray-800 placeholder-gray-500 text-base"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-gray-500 hover:text-gray-700">
                <FaTimes />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={syncEmails}
            disabled={syncing}
            className="p-2.5 text-gray-600 hover:bg-gray-200 rounded-full transition-colors"
            title="Refresh"
          >
            <MdRefresh className={`text-xl ${syncing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden bg-[#f6f8fc]">
        {/* Sidebar - Gmail Style */}
        <div className="w-64 flex-shrink-0 py-3 px-2 hidden md:block bg-[#f6f8fc] overflow-y-auto">
          {/* Compose Button */}
          <button
            onClick={() => setShowCompose(true)}
            className="flex items-center gap-3 bg-white text-gray-700 rounded-2xl shadow-md hover:shadow-lg transition-all mb-4 px-6 py-3.5 hover:bg-[#f8fafd]"
          >
            <HiOutlinePencilAlt className="text-xl text-gray-700" />
            <span className="font-medium text-sm">Compose</span>
          </button>

          {/* Primary Folders */}
          <nav className="space-y-0.5">
            {primaryFolders.map(folder => {
              const Icon = folder.icon;
              const isActive = selectedFolder === folder.id;
              const count = folderCounts[folder.id];
              const displayCount = folder.id === 'inbox' ? count?.unread : count?.total;
              return (
                <button
                  key={folder.id}
                  onClick={() => handleFolderChange(folder.id)}
                  className={`w-full flex items-center gap-4 pl-6 pr-3 py-1.5 rounded-r-full transition-colors text-sm ${isActive
                    ? 'bg-[#d3e3fd] text-[#001d35] font-semibold'
                    : 'text-gray-700 hover:bg-[#e8eaed]'
                    }`}
                >
                  <Icon className={`text-lg ${isActive ? 'text-[#001d35]' : 'text-gray-600'}`} />
                  <span className="flex-1 text-left">{folder.name}</span>
                  {displayCount > 0 && (
                    <span className={`text-xs font-semibold ${folder.id === 'inbox' ? '' : 'text-gray-500'}`}>
                      {displayCount > 999 ? '999+' : displayCount}
                    </span>
                  )}
                </button>
              );
            })}

            {/* More/Less Toggle */}
            <button
              onClick={() => setShowMoreFolders(!showMoreFolders)}
              className="w-full flex items-center gap-4 pl-6 pr-3 py-1.5 rounded-r-full transition-colors text-sm text-gray-700 hover:bg-[#e8eaed]"
            >
              {showMoreFolders ? (
                <FaChevronDown className="text-sm text-gray-600" />
              ) : (
                <FaChevronRight className="text-sm text-gray-600" />
              )}
              <span className="flex-1 text-left">{showMoreFolders ? 'Less' : 'More'}</span>
            </button>

            {/* Secondary Folders (shown when expanded) */}
            {showMoreFolders && (
              <>
                {secondaryFolders.map(folder => {
                  const Icon = folder.icon;
                  const isActive = selectedFolder === folder.id;
                  const count = folderCounts[folder.id];
                  const displayCount = count?.total || 0;
                  return (
                    <button
                      key={folder.id}
                      onClick={() => handleFolderChange(folder.id)}
                      className={`w-full flex items-center gap-4 pl-6 pr-3 py-1.5 rounded-r-full transition-colors text-sm ${isActive
                        ? 'bg-[#d3e3fd] text-[#001d35] font-semibold'
                        : 'text-gray-700 hover:bg-[#e8eaed]'
                        }`}
                    >
                      <Icon className={`text-lg ${isActive ? 'text-[#001d35]' : 'text-gray-600'}`} />
                      <span className="flex-1 text-left">{folder.name}</span>
                      {displayCount > 0 && (
                        <span className={`text-xs font-semibold ${folder.id === 'spam' ? 'text-red-600' : 'text-gray-500'}`}>
                          {displayCount > 999 ? '999+' : displayCount}
                        </span>
                      )}
                    </button>
                  );
                })}

                {/* Categories Section */}
                <div className="mt-2 pt-2 border-t border-gray-300">
                  <button
                    onClick={() => setShowCategoriesModal(true)}
                    className="w-full flex items-center gap-4 pl-6 pr-3 py-1.5 rounded-r-full transition-colors text-sm text-gray-700 hover:bg-[#e8eaed]"
                  >
                    <MdCategory className="text-lg text-gray-600" />
                    <span className="flex-1 text-left">Categories</span>
                  </button>
                </div>

                {/* Manage Labels */}
                <button
                  onClick={() => setShowLabelsModal(true)}
                  className="w-full flex items-center gap-4 pl-6 pr-3 py-1.5 rounded-r-full transition-colors text-sm text-gray-700 hover:bg-[#e8eaed] mt-1"
                >
                  <MdSettings className="text-lg text-gray-600" />
                  <span className="flex-1 text-left">Manage labels</span>
                </button>
              </>
            )}
          </nav>

          {/* Connected Email / Account Switcher */}
          <div className="mt-6 pt-4 border-t border-gray-300 px-3 relative">
            <button
              onClick={() => setShowAccountSwitcher(!showAccountSwitcher)}
              className="w-full flex items-center justify-between text-left hover:bg-gray-100 rounded-lg p-2 -m-2 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-500 truncate">
                  {showAllAccounts ? 'All Accounts' : connectedEmail}
                </p>
                <p className="text-xs text-gray-400">
                  {accounts.length} account{accounts.length !== 1 ? 's' : ''} connected
                </p>
              </div>
              <MdKeyboardArrowDown className={`text-gray-500 transition-transform ${showAccountSwitcher ? 'rotate-180' : ''}`} />
            </button>

            {/* Account Switcher Dropdown */}
            {showAccountSwitcher && (
              <div className="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50">
                <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase">Switch Account</div>

                {/* All Accounts Option */}
                <button
                  onClick={viewAllAccountsEmails}
                  className={`w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-100 transition-colors ${showAllAccounts ? 'bg-blue-50' : ''}`}
                >
                  <MdAllInbox className="text-lg text-gray-600" />
                  <div className="flex-1 text-left">
                    <p className="text-sm text-gray-800">All Accounts</p>
                    <p className="text-xs text-gray-500">View all emails together</p>
                  </div>
                  {showAllAccounts && <span className="text-blue-600">✓</span>}
                </button>

                <div className="border-t border-gray-200 my-1"></div>

                {/* Individual Accounts */}
                {accounts.map(account => (
                  <button
                    key={account.id}
                    onClick={() => switchAccount(account.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-100 transition-colors ${activeAccountId === account.id && !showAllAccounts ? 'bg-blue-50' : ''}`}
                  >
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-semibold"
                      style={{ backgroundColor: getSenderAvatar({ email: account.email }).color }}
                    >
                      {account.email[0].toUpperCase()}
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <p className="text-sm text-gray-800 truncate">{account.email}</p>
                      <p className="text-xs text-gray-500">
                        {account.unreadCount > 0 ? `${account.unreadCount} unread` : 'No unread'}
                        {account.isPrimary && ' • Primary'}
                      </p>
                    </div>
                    {activeAccountId === account.id && !showAllAccounts && <span className="text-blue-600">✓</span>}
                  </button>
                ))}

                <div className="border-t border-gray-200 my-1"></div>

                {/* Add Another Account */}
                <button
                  onClick={() => {
                    setShowAccountSwitcher(false);
                    connectEmail();
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-100 transition-colors text-blue-600"
                >
                  <span className="text-lg">+</span>
                  <span className="text-sm">Add another account</span>
                </button>

                <div className="border-t border-gray-200 my-1"></div>

                {/* Disconnect Current */}
                <button
                  onClick={() => {
                    setShowAccountSwitcher(false);
                    disconnectEmail();
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-100 transition-colors text-red-600"
                >
                  <span className="text-sm">Disconnect {showAllAccounts ? 'all accounts' : 'this account'}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Mobile Sidebar */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40 flex justify-around py-2 shadow-lg">
          {[...primaryFolders.slice(0, 3), { id: 'spam', name: 'Spam', icon: MdReportGmailerrorred }].map(folder => {
            const Icon = folder.icon;
            const isActive = selectedFolder === folder.id;
            return (
              <button
                key={folder.id}
                onClick={() => handleFolderChange(folder.id)}
                className={`flex flex-col items-center p-2 rounded-lg relative ${isActive ? 'text-[#1a73e8]' : 'text-gray-600'
                  }`}
              >
                <Icon className="text-xl" />
                <span className="text-xs mt-1">{folder.name}</span>
                {folder.id === 'inbox' && unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
                {folder.id === 'spam' && spamCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                    {spamCount > 9 ? '9+' : spamCount}
                  </span>
                )}
              </button>
            );
          })}
          <button
            onClick={() => setShowCompose(true)}
            className="flex flex-col items-center p-2 rounded-lg text-[#1a73e8]"
          >
            <HiOutlinePencilAlt className="text-xl" />
            <span className="text-xs mt-1">Compose</span>
          </button>
        </div>

        {/* Email List & Detail */}
        <div className="flex-1 flex overflow-hidden bg-white rounded-tl-2xl shadow-sm">
          {/* Email List */}
          <div className={`${selectedEmail ? 'hidden lg:flex' : 'flex'} flex-col w-full lg:w-[400px] xl:w-[450px] flex-shrink-0 border-r border-gray-200`}>
            {/* Toolbar */}
            <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-200 bg-white">
              {/* Selection checkbox */}
              <div className="relative">
                <button
                  onClick={() => {
                    if (selectedEmails.size === 0) {
                      selectAllEmails();
                    } else if (selectedEmails.size === filteredEmails.length) {
                      selectNone();
                    } else {
                      selectAllEmails();
                    }
                  }}
                  className="p-2 hover:bg-gray-100 rounded"
                  title={selectedEmails.size === 0 ? 'Select all' : 'Deselect all'}
                >
                  {selectedEmails.size === 0 ? (
                    <MdCheckBoxOutlineBlank className="text-xl text-gray-600" />
                  ) : selectedEmails.size === filteredEmails.length ? (
                    <MdCheckBox className="text-xl text-[#1a73e8]" />
                  ) : (
                    <MdIndeterminateCheckBox className="text-xl text-[#1a73e8]" />
                  )}
                </button>
              </div>

              <div className="h-5 w-px bg-gray-300 mx-1"></div>

              {/* Bulk actions - show when emails are selected */}
              {selectedEmails.size > 0 ? (
                <>
                  <button
                    onClick={bulkArchive}
                    className="p-2 hover:bg-gray-100 rounded"
                    title="Archive"
                  >
                    <MdArchive className="text-xl text-gray-600" />
                  </button>
                  <button
                    onClick={bulkDelete}
                    className="p-2 hover:bg-gray-100 rounded"
                    title={selectedFolder === 'trash' ? 'Move to Inbox' : 'Delete'}
                  >
                    <MdDelete className="text-xl text-gray-600" />
                  </button>
                  <button
                    onClick={bulkMarkRead}
                    className="p-2 hover:bg-gray-100 rounded"
                    title="Mark as read"
                  >
                    <FaRegEnvelopeOpen className="text-lg text-gray-600" />
                  </button>
                  <button
                    onClick={bulkMarkUnread}
                    className="p-2 hover:bg-gray-100 rounded"
                    title="Mark as unread"
                  >
                    <FaRegEnvelope className="text-lg text-gray-600" />
                  </button>
                  <span className="text-xs text-gray-600 ml-2">
                    {selectedEmails.size} selected
                  </span>
                </>
              ) : (
                <>
                  <button
                    onClick={syncEmails}
                    className="p-2 hover:bg-gray-100 rounded"
                    title="Refresh"
                  >
                    <MdRefresh className={`text-xl text-gray-600 ${syncing ? 'animate-spin' : ''}`} />
                  </button>
                  <button className="p-2 hover:bg-gray-100 rounded">
                    <MdMoreVert className="text-xl text-gray-600" />
                  </button>
                </>
              )}

              <div className="flex-1">
                {showAllAccounts && (
                  <span className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-full ml-2">
                    All Accounts
                  </span>
                )}
              </div>
              <span className="text-xs text-gray-500 px-2">
                {filteredEmails.length > 0 ? `1-${filteredEmails.length}` : '0'}
              </span>
              <button className="p-2 hover:bg-gray-100 rounded opacity-50" disabled>
                <FaAngleLeft className="text-gray-600" />
              </button>
              <button className="p-2 hover:bg-gray-100 rounded opacity-50" disabled>
                <FaAngleRight className="text-gray-600" />
              </button>
            </div>

            {/* Email List */}
            <div className="flex-1 overflow-y-auto pb-16 md:pb-0 bg-white">
              {error ? (
                <div className="flex flex-col items-center justify-center h-64 text-gray-500 p-4">
                  <MdInbox className="text-6xl mb-4 text-gray-300" />
                  <p className="text-lg mb-2 text-gray-600">Unable to load emails</p>
                  <p className="text-sm text-center text-red-500 mb-4">{error}</p>
                  {error.includes('API has not been used') || error.includes('disabled') ? (
                    <div className="text-center">
                      <p className="text-xs text-gray-500 mb-3">You need to enable the Gmail API in Google Cloud Console</p>
                      <a
                        href="https://console.developers.google.com/apis/api/gmail.googleapis.com/overview"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block px-4 py-2 bg-[#1a73e8] text-white rounded-lg hover:bg-[#1557b0] text-sm"
                      >
                        Enable Gmail API
                      </a>
                      <button
                        onClick={syncEmails}
                        className="ml-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm"
                      >
                        Try Again
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={syncEmails}
                      className="px-4 py-2 bg-[#1a73e8] text-white rounded-lg hover:bg-[#1557b0]"
                    >
                      Try Again
                    </button>
                  )}
                </div>
              ) : loadingEmails && emails.length === 0 ? (
                <div className="flex items-center justify-center h-40">
                  <Loader size="md" />
                </div>
              ) : filteredEmails.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                  <MdInbox className="text-6xl mb-4 text-gray-300" />
                  <p className="text-lg text-gray-600">No emails in {selectedFolder}</p>
                </div>
              ) : (
                filteredEmails.map(email => {
                  const isSelected = selectedEmails.has(email.messageId);
                  return (
                    <div
                      key={email.messageId}
                      onClick={() => {
                        setSelectedEmail(email);
                        if (!email.isRead) toggleRead(email);
                      }}
                      className={`flex items-center gap-2 px-2 py-2 border-b border-gray-100 cursor-pointer group transition-colors ${isSelected
                        ? 'bg-[#c2e7ff]'
                        : selectedEmail?.messageId === email.messageId
                          ? 'bg-[#c2dbff]'
                          : !email.isRead
                            ? 'bg-[#f2f6fc] hover:shadow-sm'
                            : 'hover:bg-gray-50'
                        }`}
                    >
                      {/* Checkbox */}
                      <button
                        onClick={(e) => toggleEmailSelection(email, e)}
                        className={`p-1.5 hover:bg-gray-200 rounded transition-opacity hidden sm:block ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                      >
                        {isSelected ? (
                          <MdCheckBox className="text-lg text-[#1a73e8]" />
                        ) : (
                          <MdCheckBoxOutlineBlank className="text-lg text-gray-500" />
                        )}
                      </button>

                      {/* Star */}
                      <button
                        onClick={(e) => toggleStar(email, e)}
                        className="p-1 hover:bg-gray-200 rounded"
                      >
                        {email.isStarred ? (
                          <MdStar className="text-lg text-yellow-500" />
                        ) : (
                          <MdStarBorder className="text-lg text-gray-400 group-hover:text-gray-600" />
                        )}
                      </button>

                      {/* Important */}
                      <button className="p-1 opacity-0 group-hover:opacity-100 hidden sm:block">
                        <MdLabelImportant className="text-lg text-gray-400 hover:text-yellow-600" />
                      </button>

                      {/* Content */}
                      <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center">
                        {/* Sender */}
                        <div className={`sm:w-44 truncate text-sm ${!email.isRead ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                          {email.from?.name || email.from?.email || '?'}
                          {/* Show account indicator when viewing all accounts */}
                          {showAllAccounts && email.accountEmail && (
                            <span className="ml-1 text-xs text-gray-400 font-normal">
                              ({email.accountEmail.split('@')[0]})
                            </span>
                          )}
                        </div>

                        {/* Subject & Snippet */}
                        <div className="flex-1 flex items-center min-w-0 gap-1">
                          <span className={`truncate text-sm ${!email.isRead ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                            {email.subject || '(no subject)'}
                          </span>
                          <span className="text-gray-500 text-sm hidden sm:inline">-</span>
                          <span className="text-gray-500 text-sm truncate flex-1 hidden sm:inline">
                            {email.snippet}
                          </span>
                        </div>
                      </div>

                      {/* Actions on hover */}
                      <div className="hidden sm:group-hover:flex items-center gap-0.5">
                        <button
                          onClick={(e) => archiveEmail(email, e)}
                          className="p-2 hover:bg-gray-200 rounded"
                          title="Archive"
                        >
                          <MdArchive className="text-lg text-gray-500" />
                        </button>
                        <button
                          onClick={(e) => deleteEmail(email, e)}
                          className="p-2 hover:bg-gray-200 rounded"
                          title="Delete"
                        >
                          <MdDelete className="text-lg text-gray-500" />
                        </button>
                        <button
                          onClick={(e) => toggleRead(email, e)}
                          className="p-2 hover:bg-gray-200 rounded"
                          title={email.isRead ? 'Mark as unread' : 'Mark as read'}
                        >
                          {email.isRead ? (
                            <FaRegEnvelope className="text-sm text-gray-500" />
                          ) : (
                            <FaRegEnvelopeOpen className="text-sm text-gray-500" />
                          )}
                        </button>
                        <button
                          onClick={(e) => handleSnoozeEmail(email, e)}
                          className="p-2 hover:bg-gray-200 rounded"
                          title="Snooze"
                        >
                          <MdSchedule className="text-lg text-gray-500" />
                        </button>
                      </div>

                      {/* Date */}
                      <div className={`text-xs text-gray-500 w-16 text-right sm:group-hover:hidden ${!email.isRead ? 'font-semibold text-gray-900' : ''}`}>
                        {formatDate(email.date)}
                      </div>

                      {/* Attachment indicator */}
                      {email.attachments?.length > 0 && (
                        <MdAttachFile className="text-gray-400 -rotate-45 sm:group-hover:hidden" />
                      )}
                    </div>
                  );
                })
              )}

              {hasMore && !loadingEmails && !error && (
                <button
                  onClick={() => fetchEmails(selectedFolder, false)}
                  className="w-full py-4 text-[#1a73e8] hover:bg-gray-50 text-sm font-medium"
                >
                  Load more
                </button>
              )}

              {loadingEmails && emails.length > 0 && (
                <div className="flex items-center justify-center py-4">
                  <Loader size="xs" />
                </div>
              )}
            </div>
          </div>

          {/* Email Detail View */}
          <div className={`${selectedEmail ? 'flex' : 'hidden lg:flex'} flex-1 flex-col min-w-0 bg-white`}>
            {selectedEmail ? (
              <>
                {/* Detail Toolbar */}
                <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-200">
                  <button
                    onClick={() => setSelectedEmail(null)}
                    className="lg:hidden p-2 hover:bg-gray-100 rounded mr-2"
                  >
                    <FaChevronLeft className="text-gray-600" />
                  </button>
                  <button
                    onClick={(e) => archiveEmail(selectedEmail, e)}
                    className="p-2 hover:bg-gray-100 rounded"
                    title="Archive"
                  >
                    <MdArchive className="text-xl text-gray-600" />
                  </button>
                  <button
                    onClick={(e) => deleteEmail(selectedEmail, e)}
                    className="p-2 hover:bg-gray-100 rounded"
                    title="Delete"
                  >
                    <MdDelete className="text-xl text-gray-600" />
                  </button>
                  <div className="h-5 w-px bg-gray-300 mx-1"></div>
                  <button
                    onClick={(e) => toggleRead(selectedEmail, e)}
                    className="p-2 hover:bg-gray-100 rounded"
                    title={selectedEmail.isRead ? 'Mark as unread' : 'Mark as read'}
                  >
                    <FaRegEnvelope className="text-gray-600" />
                  </button>
                  <button
                    onClick={(e) => handleSnoozeEmail(selectedEmail, e)}
                    className="p-2 hover:bg-gray-100 rounded"
                    title="Snooze"
                  >
                    <MdSchedule className="text-xl text-gray-600" />
                  </button>

                  {/* Move to Dropdown */}
                  <div className="relative" data-dropdown>
                    <button
                      onClick={() => {
                        setShowMoveToMenu(!showMoveToMenu);
                        setShowLabelsMenu(false);
                        setShowMoreMenu(false);
                      }}
                      className="p-2 hover:bg-gray-100 rounded"
                      title="Move to"
                    >
                      <MdMoveToInbox className="text-xl text-gray-600" />
                    </button>
                    {showMoveToMenu && (
                      <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1 min-w-[160px]">
                        <button
                          onClick={(e) => moveToFolder(selectedEmail, 'inbox', e)}
                          className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                        >
                          <MdInbox className="text-lg" />
                          Move to Inbox
                        </button>
                        <button
                          onClick={(e) => archiveEmail(selectedEmail, e)}
                          className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                        >
                          <MdArchive className="text-lg" />
                          Archive
                        </button>
                        <button
                          onClick={(e) => reportSpam(selectedEmail, e)}
                          className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                        >
                          <MdReport className="text-lg" />
                          Report spam
                        </button>
                        <button
                          onClick={(e) => deleteEmail(selectedEmail, e)}
                          className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                        >
                          <MdDelete className="text-lg" />
                          Move to Trash
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Labels Dropdown */}
                  <div className="relative" data-dropdown>
                    <button
                      onClick={() => {
                        setShowLabelsMenu(!showLabelsMenu);
                        setShowMoveToMenu(false);
                        setShowMoreMenu(false);
                      }}
                      className="p-2 hover:bg-gray-100 rounded"
                      title="Labels"
                    >
                      <MdLabel className="text-xl text-gray-600" />
                    </button>
                    {showLabelsMenu && (
                      <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1 min-w-[200px]">
                        <div className="px-4 py-2 text-sm font-medium text-gray-700 border-b border-gray-100">
                          Apply labels
                        </div>
                        <div className="max-h-[200px] overflow-y-auto">
                          {userLabels.length === 0 ? (
                            <div className="px-4 py-3 text-sm text-gray-500">
                              No labels created yet
                            </div>
                          ) : (
                            userLabels.map((label) => (
                              <button
                                key={label.id}
                                onClick={() => setShowLabelsMenu(false)}
                                className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                              >
                                <MdLabel className="text-lg" style={{ color: label.color?.backgroundColor || '#5f6368' }} />
                                {label.name}
                              </button>
                            ))
                          )}
                        </div>
                        <div className="border-t border-gray-100">
                          <button
                            onClick={() => {
                              setShowLabelsMenu(false);
                              setShowLabelsModal(true);
                            }}
                            className="w-full px-4 py-2 text-left text-sm text-[#1a73e8] hover:bg-gray-100 flex items-center gap-2"
                          >
                            <MdAdd className="text-lg" />
                            Create new label
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* More Options Dropdown */}
                  <div className="relative" data-dropdown>
                    <button
                      onClick={() => {
                        setShowMoreMenu(!showMoreMenu);
                        setShowMoveToMenu(false);
                        setShowLabelsMenu(false);
                      }}
                      className="p-2 hover:bg-gray-100 rounded"
                      title="More options"
                    >
                      <MdMoreVert className="text-xl text-gray-600" />
                    </button>
                    {showMoreMenu && (
                      <div className="absolute top-full right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1 min-w-[200px]">
                        <button
                          onClick={(e) => toggleRead(selectedEmail, e)}
                          className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                        >
                          {selectedEmail.isRead ? (
                            <>
                              <FaRegEnvelope className="text-base" />
                              Mark as unread
                            </>
                          ) : (
                            <>
                              <FaRegEnvelopeOpen className="text-base" />
                              Mark as read
                            </>
                          )}
                        </button>
                        <button
                          onClick={(e) => toggleStar(selectedEmail, e)}
                          className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                        >
                          {selectedEmail.isStarred ? (
                            <>
                              <MdStarBorder className="text-lg" />
                              Remove star
                            </>
                          ) : (
                            <>
                              <MdStar className="text-lg" />
                              Star
                            </>
                          )}
                        </button>
                        <button
                          onClick={(e) => toggleImportant(selectedEmail, e)}
                          className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                        >
                          {selectedEmail.labels?.includes('IMPORTANT') ? (
                            <>
                              <MdLabelOff className="text-lg" />
                              Mark as not important
                            </>
                          ) : (
                            <>
                              <MdLabelImportant className="text-lg" />
                              Mark as important
                            </>
                          )}
                        </button>
                        <div className="border-t border-gray-100 my-1"></div>
                        <button
                          onClick={(e) => handleSnoozeEmail(selectedEmail, e)}
                          className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                        >
                          <MdSchedule className="text-lg" />
                          Snooze
                        </button>
                        <button
                          onClick={() => setShowMoreMenu(false)}
                          className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                        >
                          <MdFilterList className="text-lg" />
                          Filter messages like this
                        </button>
                        <div className="border-t border-gray-100 my-1"></div>
                        <button
                          onClick={(e) => reportSpam(selectedEmail, e)}
                          className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                        >
                          <MdReport className="text-lg" />
                          Report spam
                        </button>
                        <button
                          onClick={() => {
                            // Print email
                            window.print();
                            setShowMoreMenu(false);
                          }}
                          className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                        >
                          <MdPrint className="text-lg" />
                          Print
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Email Content */}
                <div className="flex-1 overflow-y-auto p-4 pb-20 md:pb-4 bg-white">
                  {/* Subject */}
                  <div className="flex items-start justify-between mb-4">
                    <h1 className="text-xl md:text-2xl font-normal text-gray-900 flex-1">
                      {selectedEmail.subject || '(no subject)'}
                    </h1>
                    <button className="p-2 hover:bg-gray-100 rounded ml-2 hidden md:block">
                      <FaExpandAlt className="text-gray-500 text-sm" />
                    </button>
                  </div>

                  {/* Sender Info */}
                  <div className="flex items-start gap-3 mb-4">
                    {/* Avatar */}
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-white font-medium flex-shrink-0"
                      style={{ backgroundColor: getSenderAvatar(selectedEmail.from).color }}
                    >
                      {getSenderAvatar(selectedEmail.from).initial}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gray-900">
                          {selectedEmail.from?.name || selectedEmail.from?.email}
                        </span>
                        {selectedEmail.from?.name && (
                          <span className="text-sm text-gray-500 hidden sm:inline">
                            &lt;{selectedEmail.from?.email}&gt;
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-sm text-gray-500">
                        <span>to me</span>
                        <MdKeyboardArrowDown className="text-lg" />
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs sm:text-sm text-gray-500 hidden sm:block">
                        {new Date(selectedEmail.date).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                          hour12: true
                        })}
                      </span>
                      <button
                        onClick={(e) => toggleStar(selectedEmail, e)}
                        className="p-2 hover:bg-gray-100 rounded"
                      >
                        {selectedEmail.isStarred ? (
                          <MdStar className="text-xl text-yellow-500" />
                        ) : (
                          <MdStarBorder className="text-xl text-gray-400" />
                        )}
                      </button>
                      <button
                        onClick={() => {
                          setComposeData({
                            to: selectedEmail.from?.email || '',
                            cc: '',
                            bcc: '',
                            subject: `Re: ${selectedEmail.subject}`,
                            body: ''
                          });
                          setShowCompose(true);
                        }}
                        className="p-2 hover:bg-gray-100 rounded"
                        title="Reply"
                      >
                        <FaReply className="text-gray-500" />
                      </button>
                      <button className="p-2 hover:bg-gray-100 rounded hidden sm:block">
                        <MdMoreVert className="text-xl text-gray-500" />
                      </button>
                    </div>
                  </div>

                  {/* Email Body */}
                  <div className="md:ml-13 md:pl-10">
                    {selectedEmail.bodyHtml ? (
                      <div
                        className="prose max-w-none text-gray-800"
                        dangerouslySetInnerHTML={{ __html: selectedEmail.bodyHtml }}
                      />
                    ) : (
                      <pre className="whitespace-pre-wrap font-sans text-gray-800 text-sm md:text-base leading-relaxed">
                        {selectedEmail.body || selectedEmail.snippet}
                      </pre>
                    )}

                    {/* Attachments */}
                    {selectedEmail.attachments?.length > 0 && (
                      <div className="mt-6 pt-4 border-t border-gray-200">
                        <div className="flex flex-wrap gap-2">
                          {selectedEmail.attachments.map((att, idx) => (
                            <div
                              key={idx}
                              className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-lg border border-gray-200 hover:bg-gray-200 cursor-pointer"
                            >
                              <MdAttachFile className="text-gray-500 -rotate-45" />
                              <span className="text-sm text-gray-700">{att.filename}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Reply Box */}
                  <div className="mt-8 md:ml-10 border border-gray-300 rounded-2xl overflow-hidden">
                    <div
                      onClick={() => {
                        setComposeData({
                          to: selectedEmail.from?.email || '',
                          cc: '',
                          bcc: '',
                          subject: `Re: ${selectedEmail.subject}`,
                          body: ''
                        });
                        setShowCompose(true);
                      }}
                      className="px-4 py-3 text-gray-500 cursor-pointer hover:bg-gray-50"
                    >
                      Click here to Reply
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                <MdInbox className="text-8xl mb-4 text-gray-200" />
                <p className="text-lg text-gray-500">Select an email to read</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* AI Compose Modal */}
      {showAiCompose && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <FaMagic className="text-purple-600" />
                Write with AI
              </h3>
              <button onClick={() => setShowAiCompose(false)} className="text-gray-400 hover:text-gray-600">
                <FaTimes />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">What should this email say?</label>
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 h-32 resize-none"
                  placeholder="e.g. Write a polite decline to the meeting invitation for next Tuesday..."
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tone</label>
                <select
                  value={aiTone}
                  onChange={(e) => setAiTone(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="professional">Professional</option>
                  <option value="casual">Casual</option>
                  <option value="friendly">Friendly</option>
                  <option value="formal">Formal</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setShowAiCompose(false)}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAiCompose}
                  disabled={isGeneratingAi || !aiPrompt.trim()}
                  className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {isGeneratingAi ? <Loader size="xs" /> : <FaMagic />}
                  Generate
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Compose Modal - Gmail Style with Full Functionality */}
      {showCompose && (
        <div className={`fixed ${composeFullscreen ? 'inset-0 p-4' : 'bottom-0 right-0 sm:right-8 left-0 sm:left-auto'} z-50`}>
          <div className={`bg-white rounded-t-lg sm:rounded-lg shadow-2xl flex flex-col ${composeFullscreen
            ? 'w-full h-full rounded-lg'
            : composeMinimized
              ? 'w-72 h-10 hidden sm:flex'
              : 'w-full sm:w-[600px] h-[80vh] sm:h-[520px]'
            }`}>
            {/* Header */}
            <div
              className={`flex items-center justify-between px-3 py-2 bg-[#404040] text-white rounded-t-lg cursor-pointer ${composeMinimized ? 'rounded-b-lg' : ''}`}
              onClick={() => composeMinimized && setComposeMinimized(false)}
            >
              <span className="font-medium text-sm truncate">{composeData.subject || 'New Message'}</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={(e) => { e.stopPropagation(); setComposeMinimized(!composeMinimized); }}
                  className="p-1.5 hover:bg-gray-600 rounded hidden sm:block"
                >
                  <FaMinus className="text-xs" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setComposeFullscreen(!composeFullscreen); setComposeMinimized(false); }}
                  className="p-1.5 hover:bg-gray-600 rounded hidden sm:block"
                >
                  {composeFullscreen ? <FaCompressAlt className="text-xs" /> : <FaExpandAlt className="text-xs" />}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowCompose(false);
                    setComposeData({ to: '', cc: '', bcc: '', subject: '', body: '', isHtml: true });
                    setAttachments([]);
                    setShowEmojiPicker(false);
                    setShowFormattingToolbar(false);
                  }}
                  className="p-1.5 hover:bg-gray-600 rounded"
                >
                  <MdClose className="text-base" />
                </button>
              </div>
            </div>

            {!composeMinimized && (
              <>
                {/* Form */}
                <div className="flex-1 flex flex-col overflow-hidden">
                  {/* To */}
                  <div className="flex items-center border-b border-gray-200">
                    <span className="px-3 text-sm text-gray-500 w-12">To</span>
                    <input
                      type="text"
                      value={composeData.to}
                      onChange={(e) => setComposeData(prev => ({ ...prev, to: e.target.value }))}
                      className="flex-1 px-2 py-2.5 bg-transparent focus:outline-none text-gray-900 text-sm"
                      placeholder="Recipients"
                    />
                    {!showCcBcc && (
                      <button
                        onClick={() => setShowCcBcc(true)}
                        className="px-3 text-sm text-gray-500 hover:text-gray-700"
                      >
                        Cc Bcc
                      </button>
                    )}
                  </div>

                  {/* Cc */}
                  {showCcBcc && (
                    <div className="flex items-center border-b border-gray-200">
                      <span className="px-3 text-sm text-gray-500 w-12">Cc</span>
                      <input
                        type="text"
                        value={composeData.cc}
                        onChange={(e) => setComposeData(prev => ({ ...prev, cc: e.target.value }))}
                        className="flex-1 px-2 py-2.5 bg-transparent focus:outline-none text-gray-900 text-sm"
                      />
                    </div>
                  )}

                  {/* Bcc */}
                  {showCcBcc && (
                    <div className="flex items-center border-b border-gray-200">
                      <span className="px-3 text-sm text-gray-500 w-12">Bcc</span>
                      <input
                        type="text"
                        value={composeData.bcc}
                        onChange={(e) => setComposeData(prev => ({ ...prev, bcc: e.target.value }))}
                        className="flex-1 px-2 py-2.5 bg-transparent focus:outline-none text-gray-900 text-sm"
                      />
                    </div>
                  )}

                  {/* Subject */}
                  <div className="flex items-center border-b border-gray-200">
                    <input
                      type="text"
                      value={composeData.subject}
                      onChange={(e) => setComposeData(prev => ({ ...prev, subject: e.target.value }))}
                      placeholder="Subject"
                      className="flex-1 px-3 py-2.5 bg-transparent focus:outline-none text-gray-900 text-sm"
                    />
                  </div>

                  {/* Formatting Toolbar (shown when enabled) */}
                  {showFormattingToolbar && (
                    <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-200 bg-gray-50 flex-wrap">
                      <button
                        onClick={() => applyFormatting('bold')}
                        className="p-2 hover:bg-gray-200 rounded"
                        title="Bold (Ctrl+B)"
                      >
                        <FaBold className="text-sm text-gray-600" />
                      </button>
                      <button
                        onClick={() => applyFormatting('italic')}
                        className="p-2 hover:bg-gray-200 rounded"
                        title="Italic (Ctrl+I)"
                      >
                        <FaItalic className="text-sm text-gray-600" />
                      </button>
                      <button
                        onClick={() => applyFormatting('underline')}
                        className="p-2 hover:bg-gray-200 rounded"
                        title="Underline (Ctrl+U)"
                      >
                        <FaUnderline className="text-sm text-gray-600" />
                      </button>
                      <button
                        onClick={() => applyFormatting('strikeThrough')}
                        className="p-2 hover:bg-gray-200 rounded"
                        title="Strikethrough"
                      >
                        <FaStrikethrough className="text-sm text-gray-600" />
                      </button>
                      <div className="h-5 w-px bg-gray-300 mx-1"></div>
                      <button
                        onClick={() => applyFormatting('insertUnorderedList')}
                        className="p-2 hover:bg-gray-200 rounded"
                        title="Bulleted list"
                      >
                        <FaListUl className="text-sm text-gray-600" />
                      </button>
                      <button
                        onClick={() => applyFormatting('insertOrderedList')}
                        className="p-2 hover:bg-gray-200 rounded"
                        title="Numbered list"
                      >
                        <FaListOl className="text-sm text-gray-600" />
                      </button>
                      <button
                        onClick={() => applyFormatting('formatBlock', 'blockquote')}
                        className="p-2 hover:bg-gray-200 rounded"
                        title="Quote"
                      >
                        <FaQuoteRight className="text-sm text-gray-600" />
                      </button>
                      <div className="h-5 w-px bg-gray-300 mx-1"></div>
                      <button
                        onClick={insertLink}
                        className="p-2 hover:bg-gray-200 rounded"
                        title="Insert link"
                      >
                        <FaLink className="text-sm text-gray-600" />
                      </button>
                      <button
                        onClick={() => applyFormatting('removeFormat')}
                        className="p-2 hover:bg-gray-200 rounded"
                        title="Remove formatting"
                      >
                        <FaTimes className="text-sm text-gray-600" />
                      </button>
                    </div>
                  )}

                  {/* Body - Rich Text Editor */}
                  <div
                    ref={bodyEditorRef}
                    contentEditable
                    className="flex-1 px-3 py-2 bg-transparent focus:outline-none resize-none text-gray-900 text-sm overflow-y-auto"
                    style={{ minHeight: '150px' }}
                    placeholder="Write your message here..."
                    onInput={(e) => setComposeData(prev => ({ ...prev, body: e.target.innerHTML }))}
                    suppressContentEditableWarning={true}
                  >
                  </div>

                  {/* Attachments List */}
                  {attachments.length > 0 && (
                    <div className="px-3 py-2 border-t border-gray-200 bg-gray-50">
                      <div className="text-xs text-gray-500 mb-2">Attachments ({attachments.length})</div>
                      <div className="flex flex-wrap gap-2">
                        {attachments.map((file, idx) => (
                          <div
                            key={idx}
                            className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg border border-gray-200 text-sm group"
                          >
                            <MdAttachFile className="text-gray-400 -rotate-45" />
                            <span className="text-gray-700 max-w-[150px] truncate">{file.name}</span>
                            <span className="text-gray-400 text-xs">({formatFileSize(file.size)})</span>
                            <button
                              onClick={() => removeAttachment(idx)}
                              className="ml-1 p-1 hover:bg-gray-200 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <FaTimes className="text-xs text-gray-500" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Emoji Picker */}
                  {showEmojiPicker && (
                    <div className="absolute bottom-16 left-3 bg-white border border-gray-200 rounded-lg shadow-xl p-3 z-10 w-80">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-700">Emojis</span>
                        <button onClick={() => setShowEmojiPicker(false)} className="p-1 hover:bg-gray-100 rounded">
                          <FaTimes className="text-xs text-gray-500" />
                        </button>
                      </div>
                      <div className="grid grid-cols-10 gap-1 max-h-40 overflow-y-auto">
                        {commonEmojis.map((emoji, idx) => (
                          <button
                            key={idx}
                            onClick={() => insertEmoji(emoji)}
                            className="p-2 hover:bg-gray-100 rounded text-xl"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-3 py-2 border-t border-gray-200 bg-white">
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={sendEmail}
                      disabled={sending || !composeData.to || !composeData.subject}
                      className="flex items-center gap-2 bg-[#1a73e8] hover:bg-[#1557b0] text-white px-6 py-2 rounded font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {sending ? <Loader size="xs" /> : 'Send'}
                    </button>
                    <button className="p-2 hover:bg-gray-100 rounded hidden sm:block">
                      <MdArrowDropDown className="text-xl text-gray-600" />
                    </button>

                    <div className="h-6 w-px bg-gray-300 mx-2"></div>

                    <button
                      onClick={() => setShowAiCompose(true)}
                      className="flex items-center gap-1 p-2 hover:bg-purple-50 text-purple-600 rounded transition-colors"
                      title="Write with AI"
                    >
                      <FaMagic className="text-lg" />
                      <span className="text-xs font-medium hidden sm:inline">AI Write</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-0.5">
                    {/* Formatting Toggle */}
                    <button
                      onClick={() => setShowFormattingToolbar(!showFormattingToolbar)}
                      className={`p-2 hover:bg-gray-100 rounded hidden sm:block ${showFormattingToolbar ? 'bg-gray-200' : ''}`}
                      title="Formatting options"
                    >
                      <FaBold className="text-gray-500 text-sm" />
                    </button>

                    {/* Hidden file input */}
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={handleFileAttachment}
                    />

                    {/* Attach files */}
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="p-2 hover:bg-gray-100 rounded relative"
                      title="Attach files"
                      disabled={uploadingAttachment}
                    >
                      {uploadingAttachment ? (
                        <Loader size="xs" />
                      ) : (
                        <MdAttachFile className="text-xl text-gray-500 -rotate-45" />
                      )}
                      {attachments.length > 0 && (
                        <span className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 text-white text-xs rounded-full flex items-center justify-center">
                          {attachments.length}
                        </span>
                      )}
                    </button>

                    {/* Insert link */}
                    <button
                      onClick={insertLink}
                      className="p-2 hover:bg-gray-100 rounded hidden sm:block"
                      title="Insert link"
                    >
                      <MdInsertLink className="text-xl text-gray-500" />
                    </button>

                    {/* Insert emoji */}
                    <button
                      onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                      className={`p-2 hover:bg-gray-100 rounded hidden sm:block ${showEmojiPicker ? 'bg-gray-200' : ''}`}
                      title="Insert emoji"
                    >
                      <MdInsertEmoticon className="text-xl text-gray-500" />
                    </button>

                    <div className="flex-1"></div>

                    {/* Discard */}
                    <button
                      onClick={() => {
                        setShowCompose(false);
                        setComposeData({ to: '', cc: '', bcc: '', subject: '', body: '', isHtml: true });
                        setAttachments([]);
                        setShowEmojiPicker(false);
                        setShowFormattingToolbar(false);
                      }}
                      className="p-2 hover:bg-gray-100 rounded"
                      title="Discard draft"
                    >
                      <MdDelete className="text-xl text-gray-500" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
