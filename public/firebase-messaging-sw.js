/**
 * Firebase Messaging Service Worker
 * Handles web push notifications for Talio HRMS
 * This runs independently of the main service worker (sw.js)
 */

// Firebase SDK - import from CDN for service worker compatibility
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Firebase configuration - will be populated from environment variables
// These are injected during build or can be fetched from an API
const firebaseConfig = {
    apiKey: self.FIREBASE_API_KEY || '',
    authDomain: self.FIREBASE_AUTH_DOMAIN || '',
    projectId: self.FIREBASE_PROJECT_ID || '',
    storageBucket: self.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: self.FIREBASE_MESSAGING_SENDER_ID || '',
    appId: self.FIREBASE_APP_ID || '',
    measurementId: self.FIREBASE_MEASUREMENT_ID || ''
};

// Initialize Firebase only if config is available
let messaging = null;

async function initializeFirebase() {
    try {
        // Try to fetch config from the app if not already set
        if (!firebaseConfig.apiKey) {
            try {
                // Use public=true parameter to get config without authentication
                const response = await fetch('/api/notifications/config?public=true');
                if (response.ok) {
                    const data = await response.json();
                    if (data.success && data.config) {
                        Object.assign(firebaseConfig, {
                            apiKey: data.config.apiKey || '',
                            authDomain: data.config.authDomain || '',
                            projectId: data.config.projectId || '',
                            storageBucket: data.config.storageBucket || '',
                            messagingSenderId: data.config.messagingSenderId || '',
                            appId: data.config.appId || '',
                            measurementId: data.config.measurementId || ''
                        });
                        console.log('[Firebase SW] Config fetched successfully from API');
                    } else {
                        console.warn('[Firebase SW] API returned but config not available:', data);
                    }
                } else {
                    console.warn('[Firebase SW] Config API returned status:', response.status);
                }
            } catch (fetchError) {
                console.warn('[Firebase SW] Could not fetch config:', fetchError.message);
            }
        }

        // Validate config
        if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
            console.warn('[Firebase SW] Firebase config not available');
            return false;
        }

        // Initialize Firebase
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }

        messaging = firebase.messaging();
        console.log('[Firebase SW] ✅ Firebase Messaging initialized');
        return true;
    } catch (error) {
        console.error('[Firebase SW] ❌ Failed to initialize Firebase:', error);
        return false;
    }
}

// Initialize on service worker activation
self.addEventListener('activate', (event) => {
    console.log('[Firebase SW] Service worker activated');
    event.waitUntil(initializeFirebase());
});

// Handle background messages (when app is not in focus)
// CRITICAL: Wrapped in try-catch to prevent crashes
self.addEventListener('push', (event) => {
    console.log('[Firebase SW] Push event received:', event);

    // Wrap everything in a try-catch to prevent unhandled errors
    const handlePush = async () => {
        try {
            if (!event.data) {
                console.warn('[Firebase SW] No data in push event');
                return;
            }

            let payload;
            try {
                payload = event.data.json();
            } catch (e) {
                // Fallback for non-JSON data
                const text = event.data.text ? event.data.text() : 'New notification';
                payload = { notification: { title: 'Talio', body: text } };
            }

            console.log('[Firebase SW] Push payload:', payload);

            // Safely access notification and data with defaults
            const notification = payload?.notification || {};
            const data = payload?.data || {};

            const title = notification.title || data.title || 'Talio HRMS';
            const options = {
                body: notification.body || data.body || data.message || '',
                icon: notification.icon || data.icon || '/icons/icon-192x192.png',
                badge: '/icons/icon-72x72.png',
                tag: data.tag || `talio-${Date.now()}`,
                data: {
                    url: data.url || data.click_action || '/dashboard',
                    type: data.type || 'notification',
                    ...data
                },
                vibrate: [100, 50, 100],
                requireInteraction: data.requireInteraction === 'true' || false,
                renotify: true,
                actions: getNotificationActions(data.type)
            };

            // Add image if provided
            if (notification.image || data.image) {
                options.image = notification.image || data.image;
            }

            await self.registration.showNotification(title, options);
        } catch (error) {
            console.error('[Firebase SW] Error handling push event:', error);
            // Show a fallback notification on error
            try {
                await self.registration.showNotification('Talio', {
                    body: 'You have a new notification',
                    icon: '/icons/icon-192x192.png'
                });
            } catch (fallbackError) {
                console.error('[Firebase SW] Fallback notification also failed:', fallbackError);
            }
        }
    };

    event.waitUntil(handlePush());
});

// Handle notification click - wrapped in try-catch
self.addEventListener('notificationclick', (event) => {
    console.log('[Firebase SW] Notification clicked:', event.notification);

    try {
        event.notification.close();

        const data = event.notification?.data || {};
        const url = data.url || '/dashboard';

        // Handle action buttons
        if (event.action) {
            console.log('[Firebase SW] Action clicked:', event.action);
            // Handle specific actions based on notification type
            switch (event.action) {
                case 'view':
                    // Default - open the URL
                    break;
                case 'dismiss':
                    // Just close the notification (already done above)
                    return;
                case 'mark-read':
                    // Mark notification as read via API
                    event.waitUntil(markNotificationAsRead(data.notificationId));
                    return;
                default:
                    break;
            }
        }

        // Open or focus the app window
        event.waitUntil(
            clients.matchAll({ type: 'window', includeUncontrolled: true })
                .then((windowClients) => {
                    // Check if there's already a window/tab open
                    for (const client of windowClients) {
                        if (client.url && client.url.includes(self.location.origin) && 'focus' in client) {
                            // Navigate existing window to the target URL
                            return client.navigate(url).then(() => client.focus()).catch(err => {
                                console.warn('[Firebase SW] Navigation failed:', err);
                                // Open new window as fallback
                                if (clients.openWindow) {
                                    return clients.openWindow(url);
                                }
                            });
                        }
                    }
                    // Open new window if none exists
                    if (clients.openWindow) {
                        return clients.openWindow(url);
                    }
                })
                .catch(err => {
                    console.error('[Firebase SW] Error handling notification click:', err);
                })
        );
    } catch (error) {
        console.error('[Firebase SW] Error in notificationclick handler:', error);
    }
});

// Handle notification close
self.addEventListener('notificationclose', (event) => {
    console.log('[Firebase SW] Notification closed:', event.notification);
    // Track notification dismissal if needed
});

// Get action buttons based on notification type - with error handling
function getNotificationActions(type) {
    try {
        const defaultActions = [
            { action: 'view', title: '👀 View' },
            { action: 'dismiss', title: '✖️ Dismiss' }
        ];

        switch (type) {
            case 'leave':
                return [
                    { action: 'view', title: '📋 View Leave' },
                    { action: 'dismiss', title: '✖️ Dismiss' }
                ];
            case 'attendance':
                return [
                    { action: 'view', title: '📍 View Attendance' },
                    { action: 'dismiss', title: '✖️ Dismiss' }
                ];
            case 'task':
                return [
                    { action: 'view', title: '📝 View Task' },
                    { action: 'dismiss', title: '✖️ Dismiss' }
                ];
            case 'chat':
                return [
                    { action: 'view', title: '💬 Reply' },
                    { action: 'dismiss', title: '✖️ Dismiss' }
                ];
            case 'approval':
                return [
                    { action: 'view', title: '✅ Review' },
                    { action: 'dismiss', title: '✖️ Dismiss' }
                ];
            default:
                return defaultActions;
        }
    } catch (error) {
        console.error('[Firebase SW] Error getting notification actions:', error);
        return [
            { action: 'view', title: '👀 View' },
            { action: 'dismiss', title: '✖️ Dismiss' }
        ];
    }
}

// Mark notification as read via API
async function markNotificationAsRead(notificationId) {
    if (!notificationId) return;

    try {
        await fetch(`/api/notifications/${notificationId}/read`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            }
        });
    } catch (error) {
        console.error('[Firebase SW] Failed to mark notification as read:', error);
    }
}

// Listen for messages from the main app - wrapped in try-catch
self.addEventListener('message', (event) => {
    try {
        console.log('[Firebase SW] Message received:', event.data);

        if (event.data && event.data.type === 'FIREBASE_CONFIG') {
            // Update Firebase config from main app
            Object.assign(firebaseConfig, event.data.config);
            initializeFirebase();
        }

        if (event.data && event.data.type === 'SKIP_WAITING') {
            self.skipWaiting();
        }
    } catch (error) {
        console.error('[Firebase SW] Error handling message:', error);
    }
});

console.log('[Firebase SW] Service worker loaded');