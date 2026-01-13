'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Hook for managing web push notifications
 * Handles permission requests, subscription management, and FCM token registration
 * 
 * FIXES:
 * 1. Loading state properly cleared in all paths
 * 2. Foreground message listener set up to prevent crashes
 * 3. FCM token persisted in localStorage for refresh check
 * 4. Duplicate subscription prevention
 */
export function useWebPush() {
    const [isSupported, setIsSupported] = useState(false);
    const [permission, setPermission] = useState('default');
    const [subscription, setSubscription] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [fcmToken, setFcmToken] = useState(null);
    const [isInitialized, setIsInitialized] = useState(false);

    // Ref to track if foreground listener is set up
    const foregroundListenerRef = useRef(null);
    // Ref to prevent duplicate subscriptions
    const isSubscribingRef = useRef(false);

    // Check if push notifications are supported
    useEffect(() => {
        const checkSupport = () => {
            const supported =
                'serviceWorker' in navigator &&
                'PushManager' in window &&
                'Notification' in window;

            setIsSupported(supported);

            if (supported) {
                setPermission(Notification.permission);
            }
        };

        checkSupport();
    }, []);

    // Get existing subscription and FCM token on mount
    useEffect(() => {
        const getExistingSubscription = async () => {
            if (!isSupported) return;

            try {
                // Check for existing push subscription
                const registration = await navigator.serviceWorker.ready;
                const existingSub = await registration.pushManager.getSubscription();
                setSubscription(existingSub);

                // Check for stored FCM token in localStorage
                const storedToken = localStorage.getItem('fcm_token');
                if (storedToken) {
                    setFcmToken(storedToken);
                    console.log('[WebPush] Found stored FCM token');
                }

                setIsInitialized(true);
            } catch (err) {
                console.error('[WebPush] Error getting existing subscription:', err);
                setIsInitialized(true);
            }
        };

        getExistingSubscription();
    }, [isSupported]);

    /**
     * Request notification permission
     */
    const requestPermission = useCallback(async () => {
        if (!isSupported) {
            setError('Push notifications are not supported in this browser');
            return false;
        }

        try {
            setError(null);

            const result = await Notification.requestPermission();
            setPermission(result);

            if (result === 'granted') {
                return true;
            } else if (result === 'denied') {
                setError('Notification permission was denied. Please enable it in browser settings.');
                return false;
            } else {
                setError('Notification permission was dismissed');
                return false;
            }
        } catch (err) {
            console.error('[WebPush] Permission request error:', err);
            setError(err.message || 'Failed to request permission');
            return false;
        }
    }, [isSupported]);

    /**
     * Setup foreground message listener for Firebase
     * This handles notifications when the app is in the foreground
     * CRITICAL: Without this, foreground messages can cause crashes
     */
    const setupForegroundListener = useCallback(async (messaging) => {
        try {
            // Only set up once
            if (foregroundListenerRef.current) {
                console.log('[WebPush] Foreground listener already set up');
                return;
            }

            const { onMessage } = await import('firebase/messaging');

            foregroundListenerRef.current = onMessage(messaging, (payload) => {
                console.log('[WebPush] Foreground message received:', payload);

                try {
                    // Safely extract notification data with defaults
                    const notification = payload?.notification || {};
                    const data = payload?.data || {};

                    const title = notification.title || data.title || 'Talio Notification';
                    const body = notification.body || data.body || data.message || '';
                    const icon = notification.icon || data.icon || '/favicon.png';
                    const url = data.url || data.click_action || '/dashboard';

                    // Show browser notification for foreground messages
                    if (Notification.permission === 'granted') {
                        const browserNotification = new Notification(title, {
                            body,
                            icon,
                            tag: data.tag || `talio-fg-${Date.now()}`,
                            data: { url, ...data }
                        });

                        browserNotification.onclick = () => {
                            window.focus();
                            if (url) {
                                window.location.href = url;
                            }
                            browserNotification.close();
                        };
                    }

                    // Also emit a custom event for in-app handling
                    window.dispatchEvent(new CustomEvent('firebase-foreground-message', {
                        detail: { title, body, data }
                    }));
                } catch (innerError) {
                    // CRITICAL: Catch errors here to prevent app crash
                    console.error('[WebPush] Error processing foreground message:', innerError);
                }
            });

            console.log('[WebPush] Foreground message listener set up');
        } catch (err) {
            // Don't throw - just log the error
            console.error('[WebPush] Error setting up foreground listener:', err);
        }
    }, []);

    /**
     * Register Firebase Messaging service worker and get FCM token
     */
    const registerFirebaseMessaging = useCallback(async () => {
        try {
            // Register Firebase Messaging service worker
            const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
                scope: '/firebase-cloud-messaging-push-scope'
            });

            console.log('[WebPush] Firebase SW registered:', registration.scope);

            // Dynamically import Firebase
            const { initializeApp, getApps } = await import('firebase/app');
            const { getMessaging, getToken } = await import('firebase/messaging');

            // Get Firebase config
            const configResponse = await fetch('/api/notifications/config');
            if (!configResponse.ok) {
                console.warn('[WebPush] Failed to fetch Firebase config:', configResponse.status);
                return null;
            }

            const configData = await configResponse.json();

            if (!configData.success || !configData.config?.apiKey) {
                console.warn('[WebPush] Firebase config not available');
                return null;
            }

            const firebaseConfig = {
                apiKey: configData.config.apiKey,
                authDomain: configData.config.authDomain,
                projectId: configData.config.projectId,
                storageBucket: configData.config.storageBucket,
                messagingSenderId: configData.config.messagingSenderId,
                appId: configData.config.appId,
                measurementId: configData.config.measurementId
            };

            // Initialize Firebase
            let app;
            if (getApps().length === 0) {
                app = initializeApp(firebaseConfig);
            } else {
                app = getApps()[0];
            }

            const messaging = getMessaging(app);

            // CRITICAL: Setup foreground message listener to prevent crashes
            await setupForegroundListener(messaging);

            // Get FCM token
            const vapidKey = configData.config.vapidKey;
            if (!vapidKey) {
                console.warn('[WebPush] VAPID key not configured');
                return null;
            }

            const token = await getToken(messaging, {
                vapidKey,
                serviceWorkerRegistration: registration
            });

            if (token) {
                console.log('[WebPush] FCM token obtained');
                setFcmToken(token);

                // Store token locally for persistence check
                localStorage.setItem('fcm_token', token);

                // Send token to backend
                const authToken = localStorage.getItem('token');
                if (authToken) {
                    try {
                        const response = await fetch('/api/fcm/token', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${authToken}`
                            },
                            body: JSON.stringify({
                                fcmToken: token,
                                deviceInfo: {
                                    platform: 'web',
                                    browser: getBrowserInfo(),
                                    userAgent: navigator.userAgent
                                }
                            })
                        });

                        if (!response.ok) {
                            console.warn('[WebPush] Failed to save FCM token to backend:', response.status);
                        }
                    } catch (backendError) {
                        console.warn('[WebPush] Error saving FCM token:', backendError);
                    }
                }

                return token;
            }

            return null;
        } catch (err) {
            console.error('[WebPush] Firebase registration error:', err);
            return null;
        }
    }, [setupForegroundListener]);

    /**
     * Subscribe to web push notifications
     * FIXED: Properly handles loading state in all code paths
     */
    const subscribe = useCallback(async () => {
        // Prevent duplicate subscriptions
        if (isSubscribingRef.current) {
            console.log('[WebPush] Subscription already in progress');
            return null;
        }

        if (!isSupported) {
            setError('Push notifications are not supported');
            return null;
        }

        // Request permission if not granted
        if (permission !== 'granted') {
            const granted = await requestPermission();
            if (!granted) {
                return null;
            }
        }

        isSubscribingRef.current = true;
        setIsLoading(true);
        setError(null);

        try {
            // First try Firebase Messaging (recommended)
            const fcm = await registerFirebaseMessaging();

            // Also create a standard Web Push subscription as backup
            let pushSubscription = null;

            try {
                const registration = await navigator.serviceWorker.ready;

                // Get VAPID key from config
                const configResponse = await fetch('/api/notifications/config');
                if (configResponse.ok) {
                    const configData = await configResponse.json();
                    const vapidKey = configData.config?.vapidKey;

                    if (vapidKey) {
                        // Convert VAPID key to Uint8Array
                        const applicationServerKey = urlBase64ToUint8Array(vapidKey);

                        // Subscribe to push manager
                        pushSubscription = await registration.pushManager.subscribe({
                            userVisibleOnly: true,
                            applicationServerKey
                        });

                        setSubscription(pushSubscription);

                        // Send subscription to backend
                        const authToken = localStorage.getItem('token');
                        if (authToken) {
                            try {
                                await fetch('/api/push-subscriptions', {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'Authorization': `Bearer ${authToken}`
                                    },
                                    body: JSON.stringify({
                                        subscription: pushSubscription.toJSON(),
                                        deviceInfo: {
                                            platform: 'web',
                                            browser: getBrowserInfo(),
                                            userAgent: navigator.userAgent,
                                            deviceType: getDeviceType()
                                        }
                                    })
                                });
                            } catch (backendError) {
                                console.warn('[WebPush] Error saving push subscription:', backendError);
                            }
                        }
                    } else {
                        console.warn('[WebPush] VAPID key not available');
                    }
                }
            } catch (pushError) {
                console.warn('[WebPush] Web Push subscription failed (non-critical):', pushError);
            }

            // Success if we have either FCM or Push subscription
            if (fcm || pushSubscription) {
                console.log('[WebPush] Subscription created successfully');
                return { fcmToken: fcm, subscription: pushSubscription };
            }

            setError('Failed to subscribe to notifications');
            return null;
        } catch (err) {
            console.error('[WebPush] Subscription error:', err);
            setError(err.message || 'Failed to subscribe to notifications');
            return null;
        } finally {
            // CRITICAL: Always clear loading state
            setIsLoading(false);
            isSubscribingRef.current = false;
        }
    }, [isSupported, permission, requestPermission, registerFirebaseMessaging]);

    /**
     * Unsubscribe from push notifications
     */
    const unsubscribe = useCallback(async () => {
        setIsLoading(true);
        setError(null);

        try {
            if (subscription) {
                // Remove from backend
                const authToken = localStorage.getItem('token');
                if (authToken) {
                    try {
                        await fetch('/api/push-subscriptions', {
                            method: 'DELETE',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${authToken}`
                            },
                            body: JSON.stringify({
                                endpoint: subscription.endpoint
                            })
                        });
                    } catch (backendError) {
                        console.warn('[WebPush] Error removing push subscription from backend:', backendError);
                    }
                }

                // Unsubscribe locally
                try {
                    await subscription.unsubscribe();
                } catch (unsubError) {
                    console.warn('[WebPush] Error unsubscribing locally:', unsubError);
                }
                setSubscription(null);
            }

            // Also clear FCM token
            if (fcmToken) {
                const authToken = localStorage.getItem('token');
                if (authToken) {
                    try {
                        await fetch('/api/fcm/token', {
                            method: 'DELETE',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${authToken}`
                            },
                            body: JSON.stringify({ token: fcmToken })
                        });
                    } catch (backendError) {
                        console.warn('[WebPush] Error removing FCM token from backend:', backendError);
                    }
                }
                setFcmToken(null);
                localStorage.removeItem('fcm_token');
            }

            console.log('[WebPush] Unsubscribed successfully');
            return true;
        } catch (err) {
            console.error('[WebPush] Unsubscribe error:', err);
            setError(err.message || 'Failed to unsubscribe');
            return false;
        } finally {
            // CRITICAL: Always clear loading state
            setIsLoading(false);
        }
    }, [subscription, fcmToken]);

    /**
     * Send test notification
     */
    const sendTestNotification = useCallback(async () => {
        try {
            const authToken = localStorage.getItem('token');
            if (!authToken) {
                setError('Not authenticated');
                return false;
            }

            const response = await fetch('/api/notifications/test', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                }
            });

            const data = await response.json();
            return data.success;
        } catch (err) {
            console.error('[WebPush] Test notification error:', err);
            return false;
        }
    }, []);

    return {
        isSupported,
        permission,
        subscription,
        fcmToken,
        isLoading,
        error,
        isInitialized,
        isSubscribed: !!(subscription || fcmToken),
        requestPermission,
        subscribe,
        unsubscribe,
        sendTestNotification
    };
}

// Helper function to convert VAPID key
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// Helper function to get browser info
function getBrowserInfo() {
    const userAgent = navigator.userAgent;

    if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) {
        return 'Chrome';
    } else if (userAgent.includes('Edg')) {
        return 'Edge';
    } else if (userAgent.includes('Firefox')) {
        return 'Firefox';
    } else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
        return 'Safari';
    } else if (userAgent.includes('Opera') || userAgent.includes('OPR')) {
        return 'Opera';
    }
    return 'Unknown';
}

// Helper function to get device type
function getDeviceType() {
    const userAgent = navigator.userAgent.toLowerCase();

    if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(userAgent)) {
        return 'tablet';
    }
    if (/mobile|android|iphone|ipod|blackberry|opera mini|iemobile/i.test(userAgent)) {
        return 'mobile';
    }
    return 'desktop';
}

export default useWebPush;
