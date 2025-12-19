'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { FaPhoneAlt, FaTimes, FaVolumeUp, FaVolumeMute, FaCheck, FaUser } from 'react-icons/fa';
import { useSocket } from '@/contexts/SocketContext';
import toast from 'react-hot-toast';

// Alert sound URL - using existing notification sound, played in loop for urgency
const ALERT_SOUND_URL = '/sounds/notification.mp3';

// Priority-based styling
const priorityStyles = {
  low: {
    bg: 'bg-gray-100',
    border: 'border-gray-400',
    text: 'text-gray-800',
    pulse: ''
  },
  medium: {
    bg: 'bg-blue-100',
    border: 'border-blue-500',
    text: 'text-blue-800',
    pulse: ''
  },
  high: {
    bg: 'bg-orange-100',
    border: 'border-orange-500',
    text: 'text-orange-800',
    pulse: 'animate-pulse'
  },
  urgent: {
    bg: 'bg-red-100',
    border: 'border-red-500',
    text: 'text-red-800',
    pulse: 'animate-pulse'
  }
};

export default function CallAlertReceiver() {
  const { socket, isConnected } = useSocket();
  const [activeAlert, setActiveAlert] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioError, setAudioError] = useState(false);
  
  const alertAudioRef = useRef(null);
  const voiceAudioRef = useRef(null);
  const alertQueue = useRef([]);

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

  // Handle incoming alert
  const handleIncomingAlert = useCallback((alert) => {
    console.log('📢 [CallAlert] Received alert:', alert);

    if (activeAlert) {
      // Queue the alert if one is already active
      alertQueue.current.push(alert);
      toast('New alert queued', { icon: '📢' });
    } else {
      setActiveAlert(alert);
    }
  }, [activeAlert]);

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

  const styles = priorityStyles[activeAlert.priority] || priorityStyles.medium;

  return (
    <>
      {/* Full-screen overlay for urgent alerts */}
      {activeAlert.priority === 'urgent' && (
        <div className="fixed inset-0 bg-red-900/20 z-40 animate-pulse pointer-events-none" />
      )}

      {/* Alert Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={acknowledgeAlert} />
        
        <div className={`relative w-full max-w-md ${styles.bg} ${styles.border} border-2 rounded-2xl shadow-2xl overflow-hidden ${styles.pulse}`}>
          {/* Animated Header */}
          <div className={`relative px-6 py-4 ${
            activeAlert.priority === 'urgent' ? 'bg-red-500' :
            activeAlert.priority === 'high' ? 'bg-orange-500' :
            activeAlert.priority === 'medium' ? 'bg-blue-500' : 'bg-gray-500'
          } text-white`}>
            <div className="absolute inset-0 overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 animate-shimmer" />
            </div>
            
            <div className="relative flex items-center gap-3">
              <div className="p-3 bg-white/20 rounded-full animate-bounce">
                <FaPhoneAlt className="text-2xl" />
              </div>
              <div>
                <h2 className="text-xl font-bold">Incoming Alert</h2>
                <p className="text-sm opacity-90 capitalize">{activeAlert.priority} Priority</p>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="p-6 space-y-4">
            {/* Sender Info */}
            <div className="flex items-center gap-3 p-3 bg-white/50 dark:bg-gray-800/50 rounded-lg">
              <div className="w-12 h-12 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                <FaUser className="text-xl text-gray-500" />
              </div>
              <div>
                <p className="font-semibold text-gray-900 dark:text-white">
                  {activeAlert.sender?.name || 'Unknown'}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400 capitalize">
                  {activeAlert.sender?.role?.replace('_', ' ') || 'Team Member'}
                </p>
              </div>
            </div>

            {/* Message */}
            <div className="p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
              <p className="text-gray-800 dark:text-gray-200 leading-relaxed">
                {activeAlert.message}
              </p>
            </div>

            {/* Audio Controls */}
            {activeAlert.voiceEnabled && (
              <div className="flex items-center justify-center gap-4">
                {isPlaying ? (
                  <button
                    onClick={stopAudio}
                    className="flex items-center gap-2 px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
                  >
                    <FaVolumeMute />
                    Stop Audio
                  </button>
                ) : (
                  <button
                    onClick={replayAudio}
                    className="flex items-center gap-2 px-4 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors"
                  >
                    <FaVolumeUp />
                    {audioError ? 'Retry Audio' : 'Replay Audio'}
                  </button>
                )}
              </div>
            )}

            {/* Audio Error Message */}
            {audioError && (
              <p className="text-center text-sm text-red-600 dark:text-red-400">
                Voice playback failed. Please read the message above.
              </p>
            )}

            {/* Timestamp */}
            <p className="text-center text-xs text-gray-500 dark:text-gray-400">
              Received at {new Date(activeAlert.timestamp).toLocaleTimeString()}
            </p>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={acknowledgeAlert}
              className={`w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-semibold text-white transition-all ${
                activeAlert.priority === 'urgent' 
                  ? 'bg-red-500 hover:bg-red-600' 
                  : activeAlert.priority === 'high'
                  ? 'bg-orange-500 hover:bg-orange-600'
                  : 'bg-blue-500 hover:bg-blue-600'
              }`}
            >
              <FaCheck />
              Acknowledge Alert
            </button>
          </div>

          {/* Queue indicator */}
          {alertQueue.current.length > 0 && (
            <div className="absolute top-2 right-2 px-2 py-1 bg-black/50 text-white text-xs rounded-full">
              +{alertQueue.current.length} queued
            </div>
          )}
        </div>
      </div>

      {/* Add shimmer animation */}
      <style jsx>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-shimmer {
          animation: shimmer 2s infinite;
        }
      `}</style>
    </>
  );
}
