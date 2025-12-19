'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { FaPhoneAlt, FaTimes, FaVolumeUp, FaVolumeMute, FaCheck, FaUser, FaExclamationTriangle } from 'react-icons/fa';
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

export default function CallAlertReceiver() {
  const { socket, isConnected } = useSocket();
  const [activeAlert, setActiveAlert] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  
  const alertAudioRef = useRef(null);
  const voiceAudioRef = useRef(null);
  const alertQueue = useRef([]);
  const activeAlertRef = useRef(null);  // Ref to track active alert for stale closure handling

  // Initialize audio elements
  useEffect(() => {
    alertAudioRef.current = new Audio(ALERT_SOUND_URL);
    alertAudioRef.current.loop = false;
    
    voiceAudioRef.current = new Audio();
    voiceAudioRef.current.loop = false;

    // Handle audio end events
    alertAudioRef.current.onended = () => {
      // After alert sound, play voice if available
      if (activeAlert?.voiceEnabled && activeAlert?.audioDataUrl) {
        playVoiceMessage();
      } else {
        setIsPlaying(false);
      }
    };

    voiceAudioRef.current.onended = () => {
      setIsPlaying(false);
      markAudioPlayed();
    };

    voiceAudioRef.current.onerror = () => {
      console.error('[CallAlert] Voice audio error');
      setAudioError(true);
      setIsPlaying(false);
    };

    return () => {
      alertAudioRef.current?.pause();
      voiceAudioRef.current?.pause();
    };
  }, [activeAlert]);

  // Play alert sound
  const playAlertSound = useCallback(async () => {
    try {
      setIsPlaying(true);
      setAudioError(false);
      
      // Try to play alert sound
      if (alertAudioRef.current) {
        alertAudioRef.current.currentTime = 0;
        await alertAudioRef.current.play();
      }
    } catch (error) {
      console.error('[CallAlert] Error playing alert sound:', error);
      // If alert sound fails, try to play voice directly
      if (activeAlert?.voiceEnabled && activeAlert?.audioDataUrl) {
        playVoiceMessage();
      } else {
        setIsPlaying(false);
      }
    }
  }, [activeAlert]);

  // Play voice message
  const playVoiceMessage = useCallback(async () => {
    if (!activeAlert?.audioDataUrl) {
      setIsPlaying(false);
      return;
    }

    try {
      voiceAudioRef.current.src = activeAlert.audioDataUrl;
      await voiceAudioRef.current.play();
    } catch (error) {
      console.error('[CallAlert] Error playing voice:', error);
      setAudioError(true);
      setIsPlaying(false);
    }
  }, [activeAlert]);

  // Stop audio
  const stopAudio = useCallback(() => {
    alertAudioRef.current?.pause();
    voiceAudioRef.current?.pause();
    setIsPlaying(false);
  }, []);

  // Replay audio
  const replayAudio = useCallback(() => {
    playAlertSound();
  }, [playAlertSound]);

  // Mark audio as played
  const markAudioPlayed = useCallback(async () => {
    if (!activeAlert?.alertId) return;

    try {
      const token = localStorage.getItem('token');
      await fetch(`/api/call-alert/${activeAlert.alertId}/acknowledge`, {
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
    } catch (error) {
      console.error('[CallAlert] Error marking audio played:', error);
    }
  }, [activeAlert]);

  // Acknowledge alert
  const acknowledgeAlert = useCallback(async () => {
    if (!activeAlert?.alertId) return;

    try {
      setAcknowledging(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/call-alert/${activeAlert.alertId}/acknowledge`, {
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
  }, [activeAlert]);

  // Dismiss alert
  const dismissAlert = useCallback(() => {
    stopAudio();
    setActiveAlert(null);
    
    // Process next alert in queue
    if (alertQueue.current.length > 0) {
      const nextAlert = alertQueue.current.shift();
      setActiveAlert(nextAlert);
    }
  }, [stopAudio]);

  // Keep ref in sync with state
  useEffect(() => {
    activeAlertRef.current = activeAlert;
  }, [activeAlert]);

  // Play incoming alert audio (for queued alerts that should still be heard)
  const playIncomingAlertAudio = useCallback(async (alert) => {
    try {
      // Create a new audio instance for the queued alert
      const tempAudio = new Audio(ALERT_SOUND_URL);
      tempAudio.volume = 0.7;
      await tempAudio.play();
      
      // If voice is enabled, play voice after alert sound
      if (alert?.voiceEnabled && alert?.audioDataUrl) {
        tempAudio.onended = async () => {
          try {
            const voiceAudio = new Audio(alert.audioDataUrl);
            await voiceAudio.play();
          } catch (err) {
            console.error('[CallAlert] Error playing queued voice:', err);
          }
        };
      }
    } catch (err) {
      console.error('[CallAlert] Error playing queued alert audio:', err);
    }
  }, []);

  // Handle incoming alert
  const handleIncomingAlert = useCallback((alert) => {
    console.log('📢 [CallAlert] Received alert:', alert);

    // If no active alert, set as active and play
    // Use ref to avoid stale closure issue
    if (!activeAlertRef.current) {
      setActiveAlert(alert);
    } else {
      // Queue the alert for display after current one is dismissed
      alertQueue.current.push(alert);
      
      // IMPORTANT: Still play the audio immediately for queued alerts
      // User requested that alerts should always be played even if previous not acknowledged
      playIncomingAlertAudio(alert);
      
      // Show notification with queue count
      toast(`New alert received! (${alertQueue.current.length} queued)`, { 
        icon: '📢',
        duration: 4000
      });
    }
  }, [playIncomingAlertAudio]);  // Only depends on the audio play function

  // Auto-play when alert becomes active
  useEffect(() => {
    if (activeAlert) {
      // Small delay to ensure component is mounted
      const timer = setTimeout(() => {
        playAlertSound();
      }, 100);

      return () => clearTimeout(timer);
    }
  }, [activeAlert, playAlertSound]);

  // Subscribe to socket events
  useEffect(() => {
    if (!socket || !isConnected) return;

    socket.on('call-alert', handleIncomingAlert);

    return () => {
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
                <span className={`inline-block mt-1 px-2 py-0.5 text-xs rounded-full font-medium bg-white/20 text-white capitalize`}>
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
                  <button
                    onClick={stopAudio}
                    className="modal-btn flex items-center gap-2 bg-red-50 text-red-700 border border-red-200 hover:bg-red-100"
                  >
                    <FaVolumeMute />
                    <span>Stop Audio</span>
                  </button>
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
