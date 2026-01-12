# Talio Push Notification System Documentation

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [Current Android Implementation (Working)](#current-android-implementation)
3. [Backend Architecture](#backend-architecture)
4. [iOS Push Notification Implementation](#ios-push-notification-implementation)
5. [iOS Credentials & Configuration](#ios-credentials--configuration)
6. [Expo Mobile Integration Guide](#expo-mobile-integration-guide)
7. [API Reference](#api-reference)
8. [Testing Matrix](#testing-matrix)

---

## Executive Summary

### Current State
- ✅ **Android Push Notifications**: Fully implemented and working via Firebase Cloud Messaging (FCM)
- ❌ **iOS Push Notifications**: NOT implemented in Web/Backend
- ⏳ **Expo Mobile App**: API service stubs exist, but no actual push notification implementation

### Technology Stack
- **Backend**: Next.js API Routes + Firebase Admin SDK
- **Android (Native)**: Firebase Cloud Messaging (FCM) via Kotlin
- **iOS (To Implement)**: Firebase Cloud Messaging (FCM) with APNs
- **Mobile (Expo)**: expo-notifications + expo-device

---

## Current Android Implementation

### 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        TALIO BACKEND                            │
├─────────────────────────────────────────────────────────────────┤
│  lib/firebaseNotification.js    │  Firebase Admin SDK           │
│  lib/pushNotification.js        │  Push wrapper functions       │
│  lib/notificationService.js     │  Centralized notification hub │
├─────────────────────────────────────────────────────────────────┤
│                       API ROUTES                                │
├─────────────────────────────────────────────────────────────────┤
│  /api/fcm/token              │  Register/Remove FCM tokens      │
│  /api/notifications          │  CRUD for notification records   │
│  /api/notifications/send     │  Send custom notifications       │
│  /api/push-subscriptions     │  Web Push subscription mgmt      │
│  /api/notifications/config   │  Firebase client config          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│               FIREBASE CLOUD MESSAGING (FCM)                    │
├─────────────────────────────────────────────────────────────────┤
│  • Handles Android push delivery                                │
│  • Routes to APNs for iOS (when configured)                     │
│  • Manages device tokens & delivery status                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
┌──────────────────────────┐ ┌──────────────────────────┐
│     ANDROID NATIVE       │ │      WEB BROWSER         │
│     (Kotlin/FCM)         │ │      (Firebase JS)       │
├──────────────────────────┤ ├──────────────────────────┤
│  FirebaseMessagingService│ │  useWebPush.js hook      │
│  TalioNotificationManager│ │  Service Worker          │
│  MainActivity.kt         │ │  localStorage tokens     │
└──────────────────────────┘ └──────────────────────────┘
```

### 2. Backend Components

#### a) Firebase Admin SDK Initialization (`lib/firebaseNotification.js`)

```javascript
// Service account from environment variable
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY

// Initialization with cert credentials
firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccountJson),
    projectId: serviceAccountJson.project_id
})
```

**Key Functions:**
- `sendNotificationToDevice(token, notification, data)` - Single device
- `sendNotificationToMultipleDevices(tokens, notification, data)` - Multiple devices
- `sendNotificationToUser(user, notification, data)` - User's all devices
- `sendNotificationToUsers(users, notification, data)` - Multiple users

#### b) Push Notification Wrapper (`lib/pushNotification.js`)

Multi-tenant aware wrapper that:
- Fetches user's FCM tokens from database
- Sends via Firebase Admin SDK
- Saves notification records to database
- Handles delivery status tracking

#### c) Centralized Notification Service (`lib/notificationService.js`)

- **NotificationQueue class**: Retry mechanism with 3 max retries
- **Pre-built notification types**:
  - `sendMessageNotification()` - Chat messages
  - `sendAnnouncementNotification()` - Company announcements
  - `sendLeaveRequestNotification()` - Leave requests
  - `sendLeaveApprovedNotification()` - Leave approvals
  - `sendTaskNotification()` - Task assignments
  - `sendAttendanceNotification()` - Check-in/out alerts

### 3. User Model - FCM Token Schema

```javascript
// models/User.js
fcmTokens: [{
    token: { type: String, required: true },
    device: {
        type: String,
        enum: ['android', 'web', 'ios'],  // ← iOS already in enum!
        default: 'android'
    },
    platform: {
        type: String,
        enum: ['android', 'web', 'ios'],
        default: 'android'
    },
    deviceInfo: {
        model: String,
        osVersion: String,
        appVersion: String,
        browser: String,
        userAgent: String
    },
    createdAt: { type: Date, default: Date.now },
    lastUsed: { type: Date, default: Date.now }
}]
```

### 4. Notification Model Schema

```javascript
// models/Notification.js
{
    user: ObjectId,              // Recipient
    title: String,               // Notification title
    message: String,             // Body text
    url: String,                 // Deep link URL
    type: String,                // 'custom', 'task', 'leave', 'attendance', etc.
    priority: String,            // 'low', 'medium', 'high', 'urgent'
    read: Boolean,               // Read status
    readAt: Date,
    deliveryStatus: {
        fcm: { sent: Boolean, sentAt: Date },
        socketIO: { sent: Boolean, sentAt: Date }
    }
}
```

### 5. FCM Message Payload Structure

```javascript
// Current Android-only payload
const message = {
    token,                        // FCM registration token
    notification: {
        title: 'Talio',
        body: 'Notification message',
        image: 'optional_image_url'
    },
    data: {
        type: 'announcement',     // Notification type
        url: '/dashboard',        // Deep link
        timestamp: Date.now().toString()
    },
    android: {                    // Android-specific config
        priority: 'high',
        notification: {
            channelId: 'talio_notifications',
            sound: 'default',
            priority: 'high',
            defaultSound: true,
            defaultVibrateTimings: true
        }
    }
    // ❌ NO apns config currently!
}
```

### 6. Android Native Implementation

#### `FirebaseMessagingService.kt`
- Handles `onNewToken()` for token refresh
- Handles `onMessageReceived()` for incoming messages
- Creates notifications with proper channels
- Handles deep linking via Intent extras

#### `TalioNotificationManager.kt`
- Multiple notification channels:
  - `CHANNEL_MESSAGES` - Chat (High priority)
  - `CHANNEL_ANNOUNCEMENTS` - Announcements (High priority)
  - `CHANNEL_TASKS` - Tasks (Default priority)
  - `CHANNEL_GENERAL` - General (Default priority)
- Custom notification builders for each type

### 7. API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/fcm/token` | POST | Register FCM token |
| `/api/fcm/token` | DELETE | Remove FCM token |
| `/api/fcm/token` | PUT | Update notification preferences |
| `/api/notifications` | GET | Fetch user's notifications |
| `/api/notifications` | PATCH | Mark as read |
| `/api/notifications` | DELETE | Delete notifications |
| `/api/notifications/send` | POST | Send custom notification (admin) |
| `/api/notifications/config` | GET | Get Firebase client config |
| `/api/push-subscriptions` | POST | Save Web Push subscription |

---

## iOS Push Notification Implementation

### Why FCM for iOS?

Firebase Cloud Messaging (FCM) can send to **both Android and iOS** from a single API call:
- ✅ Single backend implementation
- ✅ FCM handles APNs routing automatically
- ✅ Same token registration flow
- ✅ Unified analytics and delivery tracking

### Required Changes

#### 1. Update Firebase Message Payload (`lib/firebaseNotification.js`)

Add `apns` configuration alongside existing `android` config:

```javascript
const message = {
    token,
    notification: {
        title: notification.title || 'Talio',
        body: notification.body || '',
    },
    data: {
        ...data,
        timestamp: Date.now().toString()
    },
    // Existing Android config
    android: {
        priority: 'high',
        notification: {
            channelId: 'talio_notifications',
            sound: 'default',
            priority: 'high'
        }
    },
    // NEW: iOS/APNs config
    apns: {
        headers: {
            'apns-priority': '10',           // High priority
            'apns-push-type': 'alert'        // Alert type
        },
        payload: {
            aps: {
                alert: {
                    title: notification.title || 'Talio',
                    body: notification.body || ''
                },
                badge: 1,                    // Badge count
                sound: 'default',
                'mutable-content': 1,        // Allows notification extension
                'content-available': 1       // Background fetch
            }
        }
    }
}
```

#### 2. Platform-Aware Token Registration

The existing `/api/fcm/token` endpoint already supports iOS:

```javascript
// Already implemented in route.js
const platform = deviceInfo?.platform || 'android'
const device = platform === 'web' ? 'web' : platform === 'ios' ? 'ios' : 'android'
```

#### 3. Badge Count Management

Add badge count update in notification payload:

```javascript
// In sendNotificationToUser
apns: {
    payload: {
        aps: {
            badge: await getUnreadCount(userId) // Dynamic badge
        }
    }
}
```

---

## iOS Credentials & Configuration

### Required Apple Developer Account Assets

| Item | Description | Where to Get |
|------|-------------|--------------|
| **Apple Developer Account** | $99/year membership | developer.apple.com |
| **Bundle ID** | App identifier (e.g., `com.talio.app`) | App Store Connect |
| **APNs Auth Key (.p8)** | Authentication key | Apple Developer Portal → Keys |
| **Team ID** | 10-character identifier | Apple Developer Portal → Membership |
| **Key ID** | APNs key identifier | Shows when creating .p8 key |

### Step-by-Step Setup

#### 1. Create APNs Key in Apple Developer Portal

1. Go to [Apple Developer Portal](https://developer.apple.com)
2. Navigate to: **Certificates, Identifiers & Profiles** → **Keys**
3. Click **+** to create new key
4. Enable **Apple Push Notifications service (APNs)**
5. Download the `.p8` file (SAVE THIS - only downloadable once!)
6. Note the **Key ID** displayed

#### 2. Get Your Team ID

1. Go to **Membership** in Apple Developer Portal
2. Copy **Team ID** (10-character string)

#### 3. Create App ID with Push Capability

1. Go to **Identifiers** → **App IDs**
2. Create or edit your App ID
3. Enable **Push Notifications** capability
4. Save

#### 4. Configure Firebase Project for APNs

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project
3. Navigate to: **Project Settings** → **Cloud Messaging**
4. Under **Apple app configuration**:
   - Upload your APNs Auth Key (.p8 file)
   - Enter Key ID
   - Enter Team ID
5. Save

### Environment Variables

Add to your `.env` (backend):

```bash
# Existing Firebase Admin SDK
FIREBASE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}

# Optional: APNs direct config (if not using Firebase Console)
APNS_KEY_ID=ABC123DEFG
APNS_TEAM_ID=TEAMID1234
APNS_BUNDLE_ID=com.talio.app
# APNS_KEY_PATH=/path/to/AuthKey_ABC123DEFG.p8
```

### Security Best Practices

1. **Never commit** `.p8` keys to version control
2. Store keys in **secure secrets management** (AWS Secrets Manager, HashiCorp Vault)
3. Use **environment variables** for all credentials
4. Rotate keys periodically
5. Use separate keys for Development vs Production

---

## Expo Mobile Integration Guide

### 1. Install Required Packages

```bash
cd talioapp

# Core notification packages
npx expo install expo-notifications expo-device expo-constants

# For background fetch (optional)
npx expo install expo-background-fetch expo-task-manager
```

### 2. Update `app.json` Configuration

```json
{
  "expo": {
    "plugins": [
      "expo-router",
      [
        "expo-notifications",
        {
          "icon": "./assets/images/notification-icon.png",
          "color": "#192A5A",
          "sounds": ["./assets/sounds/notification.wav"],
          "androidMode": "default",
          "androidCollapsedTitle": "#{unread_notifications} new notifications"
        }
      ]
    ],
    "android": {
      "googleServicesFile": "./google-services.json"
    },
    "ios": {
      "bundleIdentifier": "com.talio.app",
      "infoPlist": {
        "UIBackgroundModes": ["fetch", "remote-notification"]
      }
    }
  }
}
```

### 3. Create Push Notification Service

See implementation files:
- `services/pushNotifications.ts` - Core service
- `hooks/usePushNotifications.ts` - React hook
- `contexts/NotificationContext.tsx` - Global state

### 4. Permission Flow (Store-Safe)

**DO NOT auto-request on app launch!**

```typescript
// Show explanation first
const requestPermission = async () => {
  // 1. Check current status
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  
  if (existingStatus === 'granted') return true;
  
  // 2. Show custom explanation modal/screen
  // "Enable notifications to receive updates about..."
  
  // 3. Only then request system permission
  const { status } = await Notifications.requestPermissionsAsync();
  
  return status === 'granted';
};
```

### 5. Token Registration Flow

```typescript
// Get Expo Push Token (for FCM)
const token = await Notifications.getExpoPushTokenAsync({
  projectId: Constants.expoConfig?.extra?.eas?.projectId
});

// Or get native FCM token directly
const fcmToken = await Notifications.getDevicePushTokenAsync();

// Register with backend
await api.post('/api/fcm/token', {
  fcmToken: token.data,
  deviceInfo: {
    platform: Platform.OS, // 'ios' or 'android'
    model: Device.modelName,
    osVersion: Device.osVersion,
    appVersion: Application.nativeApplicationVersion
  }
});
```

---

## API Reference

### Register FCM Token

**POST** `/api/fcm/token`

```typescript
// Request
{
  "fcmToken": "string",
  "deviceInfo": {
    "platform": "ios" | "android" | "web",
    "model": "iPhone 15",
    "osVersion": "17.0",
    "appVersion": "1.0.0"
  }
}

// Response
{
  "success": true,
  "message": "FCM token registered successfully",
  "tokenCount": 2,
  "platform": "ios"
}
```

### Get Notifications

**GET** `/api/notifications`

Query params: `page`, `limit`, `unreadOnly`

```typescript
// Response
{
  "success": true,
  "data": [
    {
      "_id": "...",
      "title": "New Announcement",
      "message": "Company holiday on...",
      "type": "announcement",
      "read": false,
      "createdAt": "2026-01-10T..."
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 45 },
  "unreadCount": 12
}
```

### Mark as Read

**PATCH** `/api/notifications`

```typescript
// Mark specific
{ "notificationIds": ["id1", "id2"] }

// Mark all
{ "markAllAsRead": true }
```

---

## Testing Matrix

### Test Environments

| Environment | Android | iOS | Notes |
|-------------|---------|-----|-------|
| Expo Go | ✅ | ⚠️ | iOS push requires dev build |
| Development Build | ✅ | ✅ | Full functionality |
| Production (APK/AAB) | ✅ | N/A | Play Store |
| Production (TestFlight) | N/A | ✅ | App Store |

### Test Scenarios

| Scenario | Expected Behavior |
|----------|-------------------|
| App in foreground | In-app notification banner |
| App in background | System notification tray |
| App killed | System notification, tap opens app |
| Permission denied | Graceful fallback, re-prompt option |
| Multiple devices | All devices receive notification |
| Token refresh | New token auto-registered |
| Logout | Token removed from backend |

### Validation Checklist

- [ ] FCM token registers correctly on login
- [ ] iOS token identified as platform: 'ios'
- [ ] Notification received on Android device
- [ ] Notification received on iOS device
- [ ] Deep link navigates to correct screen
- [ ] Badge count updates correctly (iOS)
- [ ] Sound plays on notification
- [ ] Notification saved to database
- [ ] Read status syncs across devices
- [ ] Token removed on logout

---

## Troubleshooting

### Common Issues

1. **iOS notifications not received**
   - Verify APNs key uploaded to Firebase
   - Check bundle ID matches
   - Ensure physical device (simulators don't receive push)

2. **Token registration fails**
   - Check authentication token in request
   - Verify Firebase config is correct
   - Check network connectivity

3. **Badge count not updating**
   - Verify `content-available: 1` in payload
   - Check background modes enabled in app.json

4. **Notifications work but no sound**
   - Check device sound settings
   - Verify sound file exists in assets
   - Check notification channel settings (Android)

---

*Last Updated: January 10, 2026*
*Version: 1.0.0*
