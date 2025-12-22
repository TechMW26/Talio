'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { FaPhoneAlt, FaVolumeUp, FaVolumeMute, FaCheck, FaUser, FaExclamationTriangle } from 'react-icons/fa';
import { useSocket } from '@/contexts/SocketContext';
import toast from 'react-hot-toast';

// Alert sound URL - using existing notification sound
const ALERT_SOUND_URL = '/sounds/notification.mp3';

// Priority-based styling matching project theme
const priorityConfig = {
  low: {
    headerBg: 'bg-gray-500',
    iconBg: 'bg-gray-100',
    iconColor: 'text-gray-600',
    buttonBg: 'modal-btn-secondary',
    badgeBg: 'bg-gray-100 text-gray-700',
  },
  medium: {
    headerBg: 'bg-blue-500',
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-600',
    buttonBg: 'modal-btn-primary',
    badgeBg: 'bg-blue-100 text-blue-700',
  },
  high: {
    headerBg: 'bg-orange-500',
    iconBg: 'bg-orange-100',
    iconColor: 'text-orange-600',
    buttonBg: 'modal-btn-primary',
    badgeBg: 'bg-orange-100 text-orange-700',
  },
  urgent: {
    headerBg: 'bg-red-500',
    iconBg: 'bg-red-100',
    iconColor: 'text-red-600',
    buttonBg: 'modal-btn-danger',
    badgeBg: 'bg-red-100 text-red-700',
  }
};

/**
 * Simple audio player function - creates new Audio instance each time
 * This avoids issues with reusing audio elements
 */
async function playAudioSimple(src) {
  return new Promise((resolve, reject) => {
    try {
      console.log('[Audio] Creating new Audio for:', src.substring(0, 60));
      const audio = new Audio(src);
      
      audio.onended = () => {
        console.log('[Audio] Playback ended');
        resolve({ success: true });
      };
      
      audio.onerror = (e) => {
        console.error('[Audio] Error event:', e);
        reject(new Error('Audio playback failed'));
      };
      
      // Attempt to play
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            console.log('[Audio] Play started successfully');
          })
          .catch((err) => {
            console.error('[Audio] Play promise rejected:', err);
            reject(err);
          });
      }
    } catch (err) {
      console.error('[Audio] Exception:', err);
      reject(err);
    }
  });
}

/**
 * Play the full alert sequence: notification ding + voice message
 */
async function playFullAlertSequence(alert) {
  console.log('[CallAlert] ========== PLAYING ALERT SEQUENCE ==========');
  console.log('[CallAlert] Voice enabled:', alert?.voiceEnabled);
  console.log('[CallAlert] Audio URL present:', !!alert?.audioDataUrl);
  console.log('[CallAlert] Audio URL length:', alert?.audioDataUrl?.length || 0);
  
  let notificationPlayed = false;
  let voicePlayed = false;
  
  // Step 1: Play notification sound
  try {
    console.log('[CallAlert] Step 1: Playing notification sound...');
    await playAudioSimple(ALERT_SOUND_URL);
    notificationPlayed = true;
    console.log('[CallAlert] ✅ Notification sound completed');
  } catch (err) {
    console.error('[CallAlert] ❌ Notification sound failed:', err.message);
  }
  
  // Step 2: Play voice message if available
  if (alert?.voiceEnabled && alert?.audioDataUrl) {
    try {
      console.log('[CallAlert] Step 2: Playing voice message...');
      console.log('[CallAlert] Audio URL starts with:', alert.audioDataUrl.substring(0, 30));
      await playAudioSimple(alert.audioDataUrl);
      voicePlayed = true;
      console.log('[CallAlert] ✅ Voice message completed');
    } catch (err) {
      console.error('[CallAlert] ❌ Voice message failed:', err.message);
    }
  } else {
    console.log('[CallAlert] Step 2: Skipped (voice not enabled or no audio URL)');
  }
  
  console.log('[CallAlert] ========== SEQUENCE COMPLETE ==========');
  console.log('[CallAlert] Notification played:', notificationPlayed);
  console.log('[CallAlert] Voice played:', voicePlayed);
  
  return { notificationPlayed, voicePlayed };
}

export default function CallAlertReceiver() {
  const { socket, isConnected } = useSocket();
  const [activeAlert, setActiveAlert] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  
  const alertQueue = useRef([]);
  const activeAlertRef = useRef(null);

  // Play the current alert's audio
  const playCurrentAlert = useCallback(async () => {
    const alert = activeAlertRef.current;
    if (!alert) {
      console.log('[CallAlert] No active alert to play');
      return;
    }
    
    setIsPlaying(true);
    setAudioError(false);
    
    try {
      const result = await playFullAlertSequence(alert);
      if (alert?.voiceEnabled && !result.voicePlayed) {
        setAudioError(true);
      }
    } catch (err) {
      console.error('[CallAlert] Play sequence error:', err);
      setAudioError(true);
    }
    
    setIsPlaying(false);
  }, []);

  // Replay audio
  const replayAudio = useCallback(() => {
    playCurrentAlert();
  }, [playCurrentAlert]);

  // Dismiss current alert and process queue
  const dismissAlert = useCallback(() => {
    activeAlertRef.current = null;
    setActiveAlert(null);
    setIsPlaying(false);
    setAudioError(false);
    
    // Process next alert in queue
    if (alertQueue.current.length > 0) {
      const nextAlert = alertQueue.current.shift();
      console.log('[CallAlert] Processing next queued alert');
      activeAlertRef.current = nextAlert;
      setActiveAlert(nextAlert);
    }
  }, []);

  // Acknowledge alert
  const acknowledgeAlert = useCallback(async () => {
    const currentAlert = activeAlertRef.current;
    if (!currentAlert?.alertId) return;

    try {
      setAcknowledging(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/call-alert/${currentAlert.alertId}/acknowledge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          platform: 'web',
          audioPlayed: true
        })
      });

      const data = await response.json();
      
      if (data.success) {
        toast.success('Alert acknowledged');
        dismissAlert();
      }
    } catch (error) {
      console.error('[CallAlert] Error acknowledging alert:', error);
      toast.error('Failed to acknowledge alert');
    } finally {
      setAcknowledging(false);
    }
  }, [dismissAlert]);

  // Handle incoming alert from socket
  const handleIncomingAlert = useCallback((alert) => {
    console.log('');
    console.log('📢📢📢 [CallAlert] ========== RECEIVED ALERT ========== 📢📢📢');
    console.log('[CallAlert] Alert ID:', alert.alertId);
    console.log('[CallAlert] Sender:', alert.sender?.name);
    console.log('[CallAlert] Priority:', alert.priority);
    console.log('[CallAlert] Voice Enabled:', alert.voiceEnabled);
    console.log('[CallAlert] Audio URL Present:', !!alert.audioDataUrl);
    console.log('[CallAlert] Audio URL Length:', alert.audioDataUrl?.length || 0);
    if (alert.audioDataUrl) {
      console.log('[CallAlert] Audio URL Preview:', alert.audioDataUrl.substring(0, 50) + '...');
    }
    console.log('[CallAlert] Message:', alert.message?.substring(0, 100));
    console.log('');
    
    // Validate audioDataUrl if voice is enabled
    if (alert.voiceEnabled && alert.audioDataUrl) {
      if (!alert.audioDataUrl.startsWith('data:audio/')) {
        console.error('[CallAlert] ❌ INVALID AUDIO FORMAT');
        console.error('[CallAlert] Expected: data:audio/...');
        console.error('[CallAlert] Got:', alert.audioDataUrl.substring(0, 50));
        alert.voiceEnabled = false;
      } else if (alert.audioDataUrl.length < 1000) {
        console.error('[CallAlert] ❌ AUDIO DATA TOO SHORT (likely truncated)');
        console.error('[CallAlert] Length:', alert.audioDataUrl.length);
        alert.voiceEnabled = false;
      } else {
        console.log('[CallAlert] ✅ Audio data validated successfully');
      }
    }

    // If no active alert, set as active
    if (!activeAlertRef.current) {
      console.log('[CallAlert] Setting as active alert (no current alert)');
      activeAlertRef.current = alert;
      setActiveAlert(alert);
    } else {
      // Queue the alert
      console.log('[CallAlert] Current alert exists, queueing. Queue size:', alertQueue.current.length + 1);
      alertQueue.current.push(alert);
      
      // Still play audio for queued alerts immediately
      console.log('[CallAlert] Playing queued alert audio immediately');
      playFullAlertSequence(alert);
      
      toast(`New alert received! (${alertQueue.current.length} queued)`, { 
        icon: '📢',
        duration: 4000
      });
    }
  }, []);

  // Auto-play when alert becomes active
  useEffect(() => {
    if (activeAlert) {
      activeAlertRef.current = activeAlert;
      console.log('[CallAlert] Active alert set, scheduling playback in 100ms');
      
      const timer = setTimeout(() => {
        playCurrentAlert();
      }, 100);

      return () => clearTimeout(timer);
    }
  }, [activeAlert, playCurrentAlert]);

  // Subscribe to socket events
  useEffect(() => {
    if (!socket || !isConnected) {
      console.log('[CallAlert] Socket not ready. socket:', !!socket, 'connected:', isConnected);
      return;
    }

    console.log('[CallAlert] ✅ Subscribing to call-alert socket events');
    socket.on('call-alert', handleIncomingAlert);

    return () => {
      console.log('[CallAlert] Unsubscribing from call-alert events');
      socket.off('call-alert', handleIncomingAlert);
    };
  }, [socket, isConnected, handleIncomingAlert]);

  // Don't render if no active alert
  if (!activeAlert) return null;

  const config = priorityConfig[activeAlert.priority] || priorityConfig.medium;

  return (
    <>
      {/* Urgent alert overlay effect */}
      {activeAlert.priority === 'urgent' && (
        <div className="fixed inset-0 bg-red-500/10 z-[99997] animate-pulse pointer-events-none" />
      )}

      {/* Modal using project's unified modal system */}
      <div className="modal-overlay" style={{ zIndex: 99999 }}>
        <div className="modal-backdrop" />
        
        <div className="modal-container modal-md" style={{ overflow: 'visible' }}>
          {/* Header with priority color */}
          <div className={`modal-header ${config.headerBg}`} style={{ borderBottom: 'none' }}>
            <div className="flex items-center gap-3 text-white">
              <div className="p-2.5 bg-white/20 rounded-lg animate-pulse">
                <FaPhoneAlt className="text-xl" />
              </div>
              <div>
                <h3 className="modal-title text-white">Incoming Alert</h3>
                <span className="inline-block mt-1 px-2 py-0.5 text-xs rounded-full font-medium bg-white/20 text-white capitalize">
                  {activeAlert.priority} Priority
                </span>
              </div>
            </div>
            
            {/* Queue indicator */}
            {alertQueue.current.length > 0 && (
              <span className="px-2 py-1 bg-white/20 text-white text-xs rounded-full font-medium">
                +{alertQueue.current.length} queued
              </span>
            )}
          </div>

          {/* Body */}
          <div className="modal-body space-y-4">
            {/* Sender Info Card */}
            <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg border border-gray-100">
              <div className={`w-14 h-14 rounded-full ${config.iconBg} flex items-center justify-center`}>
                <FaUser className={`text-2xl ${config.iconColor}`} />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-900 text-lg">
                  {activeAlert.sender?.name || 'Unknown Sender'}
                </p>
                <p className="text-sm text-gray-500 capitalize">
                  {activeAlert.sender?.role?.replace('_', ' ') || 'Team Member'}
                </p>
              </div>
            </div>

            {/* Message Card */}
            <div className="p-4 bg-white rounded-lg border border-gray-200">
              <p className="text-sm font-medium text-gray-500 mb-2">Message:</p>
              <p className="text-gray-800 leading-relaxed text-base">
                {activeAlert.message}
              </p>
            </div>

            {/* Audio Controls */}
            {activeAlert.voiceEnabled && (
              <div className="flex items-center justify-center gap-3 py-2">
                {isPlaying ? (
                  <div className="flex items-center gap-2 text-green-600">
                    <div className="animate-pulse">
                      <FaVolumeUp />
                    </div>
                    <span className="text-sm">Playing audio...</span>
                  </div>
                ) : (
                  <button
                    onClick={replayAudio}
                    className="modal-btn flex items-center gap-2 bg-green-50 text-green-700 border border-green-200 hover:bg-green-100"
                  >
                    <FaVolumeUp />
                    <span>{audioError ? 'Retry Audio' : 'Replay Audio'}</span>
                  </button>
                )}
              </div>
            )}

            {/* Audio Error Message */}
            {audioError && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600">
                <FaExclamationTriangle />
                <span>Voice playback failed. Please read the message above.</span>
              </div>
            )}

            {/* Timestamp */}
            <p className="text-center text-xs text-gray-400">
              Received at {new Date(activeAlert.timestamp).toLocaleTimeString([], { 
                hour: '2-digit', 
                minute: '2-digit',
                hour12: true 
              })}
            </p>
          </div>

          {/* Footer */}
          <div className="modal-footer">
            <button
              onClick={acknowledgeAlert}
              disabled={acknowledging}
              className={`modal-btn ${config.buttonBg} w-full flex items-center justify-center gap-2`}
              style={activeAlert.priority !== 'low' && activeAlert.priority !== 'urgent' ? {
                background: 'linear-gradient(135deg, var(--color-primary-500) 0%, var(--color-primary-600) 100%)'
              } : {}}
            >
              {acknowledging ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white"></div>
                  <span>Acknowledging...</span>
                </>
              ) : (
                <>
                  <FaCheck />
                  <span>Acknowledge Alert</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
