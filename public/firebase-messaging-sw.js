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
                const response = await fetch('/api/notifications/config');
                if (response.ok) {
                    const config = await response.json();
                    if (config.success && config.config) {
                        Object.assign(firebaseConfig, {
                            apiKey: config.config.apiKey,
                            authDomain: config.config.authDomain,
                            projectId: config.config.projectId,
                            storageBucket: config.config.storageBucket,
                            messagingSenderId: config.config.messagingSenderId,
                            appId: config.config.appId,
                            measurementId: config.config.measurementId
                        });
                    }
                }
            } catch (fetchError) {
                console.warn('[Firebase SW] Could not fetch config:', fetchError);
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
self.addEventListener('push', (event) => {
    console.log('[Firebase SW] Push event received:', event);

    if (!event.data) {
        console.warn('[Firebase SW] No data in push event');
        return;
    }

    let payload;
    try {
        payload = event.data.json();
    } catch (e) {
        payload = { notification: { title: 'Talio', body: event.data.text() } };
    }

    console.log('[Firebase SW] Push payload:', payload);

    const notification = payload.notification || {};
    const data = payload.data || {};

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

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
    console.log('[Firebase SW] Notification clicked:', event.notification);

    event.notification.close();

    const data = event.notification.data || {};
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
                    if (client.url.includes(self.location.origin) && 'focus' in client) {
                        // Navigate existing window to the target URL
                        return client.navigate(url).then(() => client.focus());
                    }
                }
                // Open new window if none exists
                if (clients.openWindow) {
                    return clients.openWindow(url);
                }
            })
    );
});

// Handle notification close
self.addEventListener('notificationclose', (event) => {
    console.log('[Firebase SW] Notification closed:', event.notification);
    // Track notification dismissal if needed
});

// Get action buttons based on notification type
function getNotificationActions(type) {
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

// Listen for messages from the main app
self.addEventListener('message', (event) => {
    console.log('[Firebase SW] Message received:', event.data);

    if (event.data && event.data.type === 'FIREBASE_CONFIG') {
        // Update Firebase config from main app
        Object.assign(firebaseConfig, event.data.config);
        initializeFirebase();
    }

    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

console.log('[Firebase SW] Service worker loaded');
