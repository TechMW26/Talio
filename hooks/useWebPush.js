'use client';

import { useState, useEffect, useCallback } from 'react';

/**
 * Hook for managing web push notifications
 * Handles permission requests, subscription management, and FCM token registration
 */
export function useWebPush() {
    const [isSupported, setIsSupported] = useState(false);
    const [permission, setPermission] = useState('default');
    const [subscription, setSubscription] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [fcmToken, setFcmToken] = useState(null);

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

    // Get existing subscription on mount
    useEffect(() => {
        const getExistingSubscription = async () => {
            if (!isSupported) return;

            try {
                const registration = await navigator.serviceWorker.ready;
                const existingSub = await registration.pushManager.getSubscription();
                setSubscription(existingSub);
            } catch (err) {
                console.error('[WebPush] Error getting existing subscription:', err);
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
            setIsLoading(true);
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
            setError(err.message);
            return false;
        } finally {
            setIsLoading(false);
        }
    }, [isSupported]);

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

                // Send token to backend
                const authToken = localStorage.getItem('token');
                if (authToken) {
                    await fetch('/api/fcm/token', {
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
                }

                return token;
            }

            return null;
        } catch (err) {
            console.error('[WebPush] Firebase registration error:', err);
            return null;
        }
    }, []);

    /**
     * Subscribe to web push notifications
     */
    const subscribe = useCallback(async () => {
        if (!isSupported) {
            setError('Push notifications are not supported');
            return null;
        }

        if (permission !== 'granted') {
            const granted = await requestPermission();
            if (!granted) return null;
        }

        try {
            setIsLoading(true);
            setError(null);

            // First try Firebase Messaging (recommended)
            const fcm = await registerFirebaseMessaging();

            // Also create a standard Web Push subscription as backup
            const registration = await navigator.serviceWorker.ready;

            // Get VAPID key from config
            const configResponse = await fetch('/api/notifications/config');
            const configData = await configResponse.json();
            const vapidKey = configData.config?.vapidKey;

            if (!vapidKey) {
                console.warn('[WebPush] VAPID key not available');
                return { fcmToken: fcm, subscription: null };
            }

            // Convert VAPID key to Uint8Array
            const applicationServerKey = urlBase64ToUint8Array(vapidKey);

            // Subscribe to push manager
            const pushSubscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey
            });

            setSubscription(pushSubscription);

            // Send subscription to backend
            const authToken = localStorage.getItem('token');
            if (authToken) {
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
            }

            console.log('[WebPush] Subscription created successfully');
            return { fcmToken: fcm, subscription: pushSubscription };
        } catch (err) {
            console.error('[WebPush] Subscription error:', err);
            setError(err.message);
            return null;
        } finally {
            setIsLoading(false);
        }
    }, [isSupported, permission, requestPermission, registerFirebaseMessaging]);

    /**
     * Unsubscribe from push notifications
     */
    const unsubscribe = useCallback(async () => {
        try {
            setIsLoading(true);

            if (subscription) {
                // Remove from backend
                const authToken = localStorage.getItem('token');
                if (authToken) {
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
                }

                // Unsubscribe locally
                await subscription.unsubscribe();
                setSubscription(null);
            }

            // Also clear FCM token
            if (fcmToken) {
                const authToken = localStorage.getItem('token');
                if (authToken) {
                    await fetch('/api/fcm/token', {
                        method: 'DELETE',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${authToken}`
                        },
                        body: JSON.stringify({ token: fcmToken })
                    });
                }
                setFcmToken(null);
            }

            console.log('[WebPush] Unsubscribed successfully');
            return true;
        } catch (err) {
            console.error('[WebPush] Unsubscribe error:', err);
            setError(err.message);
            return false;
        } finally {
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
        isSubscribed: !!subscription || !!fcmToken,
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
