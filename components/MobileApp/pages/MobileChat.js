'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '../components/MobileLayout';
import '@/components/MobileApp/styles/mobile.css';

/**
 * Mobile Chat Page
 * Chat interface optimized for mobile
 */
export default function MobileChat({ 
  user, 
  chats = [],
  selectedChatId = null,
  messages = [],
  onSendMessage
}) {
  const router = useRouter();
  const [view, setView] = useState(selectedChatId ? 'individual' : 'list');
  const [selectedChat, setSelectedChat] = useState(null);
  const [messageText, setMessageText] = useState('');
  const [currentMessages, setCurrentMessages] = useState(messages);
  const messagesEndRef = useRef(null);

  // Update view when selectedChatId changes
  useEffect(() => {
    if (selectedChatId) {
      const chat = chats.find(c => c._id === selectedChatId);
      if (chat) {
        setSelectedChat(chat);
        setView('individual');
      }
    }
  }, [selectedChatId, chats]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentMessages]);

  // Format time
  const formatTime = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  // Format last message time
  const formatLastMessageTime = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return formatTime(dateString);
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return date.toLocaleDateString('en-US', { weekday: 'short' });
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Get chat name
  const getChatName = (chat) => {
    if (chat.isGroup) return chat.name;
    const otherParticipant = chat.participants?.find(p => p._id !== user?.userId && p._id !== user?._id);
    return otherParticipant?.firstName ? `${otherParticipant.firstName} ${otherParticipant.lastName || ''}`.trim() : 'Unknown';
  };

  // Get chat avatar
  const getChatAvatar = (chat) => {
    if (chat.isGroup) return null;
    const otherParticipant = chat.participants?.find(p => p._id !== user?.userId && p._id !== user?._id);
    return otherParticipant?.avatar;
  };

  // Get chat initials
  const getChatInitials = (chat) => {
    const name = getChatName(chat);
    if (chat.isGroup) return name.substring(0, 2).toUpperCase();
    const parts = name.split(' ');
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return name.substring(0, 2).toUpperCase();
  };

  // Handle send message
  const handleSend = () => {
    if (!messageText.trim() || !selectedChat) return;
    
    const newMessage = {
      _id: Date.now().toString(),
      content: messageText,
      sender: { _id: user?.userId || user?._id },
      createdAt: new Date().toISOString(),
      status: 'sent'
    };
    
    setCurrentMessages(prev => [...prev, newMessage]);
    setMessageText('');
    
    if (onSendMessage) {
      onSendMessage(selectedChat._id, messageText);
    }
  };

  // Handle select chat
  const handleSelectChat = (chat) => {
    setSelectedChat(chat);
    setView('individual');
    router.push(`/dashboard/chat/${chat._id}`, { scroll: false });
  };

  // Handle back to list
  const handleBack = () => {
    setView('list');
    setSelectedChat(null);
    router.push('/dashboard/chat', { scroll: false });
  };

  // Individual Chat View
  if (view === 'individual' && selectedChat) {
    return (
      <div className="mobile-layout mobile-animate-slide-right">
        {/* Chat Header */}
        <div style={{
          background: 'white',
          borderBottom: '1px solid var(--mobile-gray-100)',
          padding: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'sticky',
          top: 0,
          zIndex: 10,
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button 
              onClick={handleBack}
              style={{ padding: '8px', marginLeft: '-8px', borderRadius: '50%', background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              <span className="material-icons-round">arrow_back</span>
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ position: 'relative' }}>
                {getChatAvatar(selectedChat) ? (
                  <img src={getChatAvatar(selectedChat)} style={{ width: '40px', height: '40px', borderRadius: '50%', border: '1px solid var(--mobile-gray-100)' }} />
                ) : (
                  <div style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    background: selectedChat.isGroup ? 'var(--mobile-purple-100)' : 'var(--mobile-primary)',
                    color: selectedChat.isGroup ? 'var(--mobile-purple-600)' : 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: '14px'
                  }}>
                    {getChatInitials(selectedChat)}
                  </div>
                )}
                <div style={{
                  position: 'absolute',
                  bottom: 0,
                  right: 0,
                  width: '12px',
                  height: '12px',
                  background: 'var(--mobile-green-500)',
                  borderRadius: '50%',
                  border: '2px solid white'
                }} />
              </div>
              <div>
                <h4 style={{ fontWeight: 700, fontSize: '14px', lineHeight: 1 }}>{getChatName(selectedChat)}</h4>
                <p style={{ fontSize: '10px', fontWeight: 700, color: 'var(--mobile-green-500)', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: '4px' }}>Online</p>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button style={{ padding: '8px', color: 'var(--mobile-gray-400)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
              <span className="material-icons-round">call</span>
            </button>
            <button style={{ padding: '8px', color: 'var(--mobile-gray-400)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
              <span className="material-icons-round">videocam</span>
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="mobile-main mobile-no-scrollbar" style={{ padding: '20px', paddingBottom: '80px' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
            <span style={{
              padding: '6px 16px',
              background: 'var(--mobile-gray-100)',
              borderRadius: '9999px',
              fontSize: '10px',
              fontWeight: 900,
              color: 'var(--mobile-gray-400)',
              textTransform: 'uppercase',
              letterSpacing: '0.1em'
            }}>Today</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {currentMessages.map((msg, idx) => {
              const isSent = msg.sender?._id === user?.userId || msg.sender?._id === user?._id;
              return (
                <div key={msg._id || idx} style={{ display: 'flex', flexDirection: 'column', alignItems: isSent ? 'flex-end' : 'flex-start' }}>
                  {!isSent && (
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', maxWidth: '80%' }}>
                      <img src={getChatAvatar(selectedChat) || `https://ui-avatars.com/api/?name=${getChatName(selectedChat)}&background=random`} style={{ width: '32px', height: '32px', borderRadius: '50%' }} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div className="mobile-chat-bubble mobile-chat-bubble-received">
                          {msg.content}
                        </div>
                        <span className="mobile-chat-bubble-time" style={{ paddingLeft: '4px' }}>{formatTime(msg.createdAt)}</span>
                      </div>
                    </div>
                  )}
                  {isSent && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', maxWidth: '80%' }}>
                      <div className="mobile-chat-bubble mobile-chat-bubble-sent">
                        {msg.content}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', paddingRight: '4px' }}>
                        <span className="mobile-chat-bubble-time">{formatTime(msg.createdAt)}</span>
                        <span className="material-icons-round" style={{ fontSize: '12px', color: 'var(--mobile-primary)' }}>done_all</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Chat Input */}
        <div className="mobile-chat-input-container">
          <div className="mobile-chat-input-row">
            <button style={{ padding: '8px', borderRadius: '50%', background: 'var(--mobile-gray-100)', color: 'var(--mobile-gray-400)', border: 'none', cursor: 'pointer' }}>
              <span className="material-icons-round">add</span>
            </button>
            <div style={{ flex: 1, background: 'var(--mobile-gray-50)', borderRadius: '16px', padding: '12px 16px', display: 'flex', alignItems: 'center' }}>
              <input 
                type="text"
                className="mobile-chat-input-field"
                placeholder="Type a message..."
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                style={{ background: 'transparent', padding: 0 }}
              />
              <button style={{ color: 'var(--mobile-gray-300)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                <span className="material-icons-outlined">sentiment_satisfied</span>
              </button>
            </div>
            <button 
              className="mobile-chat-send-btn"
              onClick={handleSend}
              disabled={!messageText.trim()}
            >
              <span className="material-icons-round">send</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Chat List View
  return (
    <MobileLayout title="Chat" user={user}>
      <div className="mobile-page">
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '32px' }}>
          <div>
            <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>Messages</h2>
            <p style={{ color: 'var(--mobile-gray-400)', fontSize: '14px', fontWeight: 500 }}>Connect with your team</p>
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              background: 'var(--mobile-indigo-50)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--mobile-indigo-500)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              border: 'none',
              cursor: 'pointer',
              transition: 'transform 0.2s'
            }}>
              <span className="material-icons-round" style={{ fontSize: '24px' }}>person_add</span>
            </button>
            <button style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              background: 'var(--mobile-emerald-50)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--mobile-emerald-500)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              border: 'none',
              cursor: 'pointer',
              transition: 'transform 0.2s'
            }}>
              <span className="material-icons-round" style={{ fontSize: '24px' }}>groups</span>
            </button>
          </div>
        </div>

        {/* Chat List */}
        <div>
          {chats.length > 0 ? (
            chats.map((chat, idx) => (
              <div 
                key={chat._id || idx}
                className="mobile-chat-list-item"
                onClick={() => handleSelectChat(chat)}
              >
                <div className="mobile-chat-avatar">
                  {getChatAvatar(chat) ? (
                    <img src={getChatAvatar(chat)} alt={getChatName(chat)} />
                  ) : (
                    <div className="mobile-chat-avatar-placeholder" style={{
                      background: chat.isGroup ? 'var(--mobile-purple-100)' : 'var(--mobile-primary)',
                      color: chat.isGroup ? 'var(--mobile-purple-600)' : 'white'
                    }}>
                      {chat.isGroup ? (
                        <span className="material-icons-round" style={{ fontSize: '24px' }}>groups</span>
                      ) : getChatInitials(chat)}
                    </div>
                  )}
                  <div className="mobile-chat-avatar-status" style={{ background: 'var(--mobile-green-500)' }} />
                </div>
                <div className="mobile-chat-content">
                  <div className="mobile-chat-header">
                    <h3 className="mobile-chat-name">{getChatName(chat)}</h3>
                    <span className="mobile-chat-time">{formatLastMessageTime(chat.lastMessage?.createdAt || chat.updatedAt)}</span>
                  </div>
                  <p className={`mobile-chat-message ${!chat.lastMessage?.content ? 'mobile-chat-message-empty' : ''}`}>
                    {chat.lastMessage?.content || 'No messages yet'}
                  </p>
                </div>
              </div>
            ))
          ) : (
            <div className="mobile-empty">
              <div className="mobile-empty-icon">
                <span className="material-icons-outlined">chat_bubble_outline</span>
              </div>
              <h4 className="mobile-empty-title">No conversations yet</h4>
              <p className="mobile-empty-text">Start a new chat to connect with your team</p>
            </div>
          )}
        </div>

        {/* FAB */}
        <button className="mobile-fab">
          <span className="material-icons-round" style={{ fontSize: '24px' }}>edit</span>
        </button>
      </div>
    </MobileLayout>
  );
}
