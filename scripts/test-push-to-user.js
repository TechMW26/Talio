/**
 * Test Push Notification Script
 * 
 * This script sends a test push notification to a specific user
 * Usage: node scripts/test-push-to-user.js <email>
 */

import 'dotenv/config'
import mongoose from 'mongoose'
import admin from 'firebase-admin'

const MONGODB_URI = process.env.MONGODB_URI
const TARGET_EMAIL = process.argv[2] || 'adil.khan@mushroomworldgroup.com'

// Firebase Admin SDK initialization
let firebaseApp = null

function initializeFirebase() {
    if (firebaseApp) return firebaseApp
    if (admin.apps.length > 0) {
        firebaseApp = admin.apps[0]
        return firebaseApp
    }

    try {
        const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
        if (!serviceAccount) {
            console.error('❌ FIREBASE_SERVICE_ACCOUNT_KEY not found')
            return null
        }

        const serviceAccountJson = JSON.parse(serviceAccount)
        firebaseApp = admin.initializeApp({
            credential: admin.credential.cert(serviceAccountJson),
            projectId: serviceAccountJson.project_id
        })

        console.log('✅ Firebase Admin SDK initialized')
        return firebaseApp
    } catch (error) {
        console.error('❌ Firebase init error:', error.message)
        return null
    }
}

async function main() {
    console.log('='.repeat(60))
    console.log('🔔 Push Notification Test Script')
    console.log('='.repeat(60))
    console.log(`📧 Target email: ${TARGET_EMAIL}`)
    console.log('')

    // Connect to MongoDB
    console.log('📦 Connecting to MongoDB...')
    try {
        await mongoose.connect(MONGODB_URI)
        console.log('✅ Connected to MongoDB')
    } catch (error) {
        console.error('❌ MongoDB connection failed:', error.message)
        process.exit(1)
    }

    // Get User model
    const UserSchema = new mongoose.Schema({
        email: String,
        name: String,
        fcmTokens: [{
            token: String,
            deviceInfo: {
                platform: String,
                model: String,
                osVersion: String,
                appVersion: String
            },
            registeredAt: Date,
            lastUsed: Date
        }]
    }, { strict: false })

    const User = mongoose.models.User || mongoose.model('User', UserSchema)

    // Find the user
    console.log('\n🔍 Looking for user...')
    const user = await User.findOne({ email: TARGET_EMAIL })

    if (!user) {
        console.error(`❌ User not found: ${TARGET_EMAIL}`)
        await mongoose.disconnect()
        process.exit(1)
    }

    console.log(`✅ Found user: ${user.name} (${user.email})`)
    console.log(`   User ID: ${user._id}`)

    // Check FCM tokens
    console.log('\n📱 Checking FCM tokens...')
    const tokens = user.fcmTokens || []

    if (tokens.length === 0) {
        console.error('❌ No FCM tokens registered for this user!')
        console.log('')
        console.log('💡 The user needs to:')
        console.log('   1. Open the app on a physical device')
        console.log('   2. Login to the app')
        console.log('   3. Grant notification permission')
        console.log('   4. Check logcat/console for "[FCM] Token registered" message')
        await mongoose.disconnect()
        process.exit(1)
    }

    console.log(`✅ Found ${tokens.length} FCM token(s):`)
    tokens.forEach((t, i) => {
        console.log(`   ${i + 1}. Platform: ${t.deviceInfo?.platform || 'unknown'}`)
        console.log(`      Model: ${t.deviceInfo?.model || 'unknown'}`)
        console.log(`      Token: ${t.token?.substring(0, 30)}...`)
        console.log(`      Registered: ${t.registeredAt || 'unknown'}`)
    })

    // Initialize Firebase
    console.log('\n🔥 Initializing Firebase...')
    const app = initializeFirebase()
    if (!app) {
        await mongoose.disconnect()
        process.exit(1)
    }

    // Send test notification to each token
    console.log('\n📤 Sending test notifications...')
    
    for (let i = 0; i < tokens.length; i++) {
        const tokenData = tokens[i]
        const token = tokenData.token

        console.log(`\n   Sending to token ${i + 1}/${tokens.length}...`)
        console.log(`   Platform: ${tokenData.deviceInfo?.platform}`)

        const message = {
            token,
            notification: {
                title: '🔔 Test Push Notification',
                body: `Hello ${user.name}! This is a test notification from Talio backend. Time: ${new Date().toLocaleTimeString()}`
            },
            data: {
                type: 'test',
                timestamp: Date.now().toString(),
                url: '/dashboard'
            },
            android: {
                priority: 'high',
                notification: {
                    channelId: 'talio_notifications',
                    priority: 'high',
                    defaultSound: true,
                    defaultVibrateTimings: true,
                    visibility: 'public'
                }
            },
            apns: {
                payload: {
                    aps: {
                        alert: {
                            title: '🔔 Test Push Notification',
                            body: `Hello ${user.name}! This is a test notification from Talio backend.`
                        },
                        sound: 'default',
                        badge: 1
                    }
                }
            }
        }

        try {
            const result = await admin.messaging().send(message)
            console.log(`   ✅ SUCCESS! Message ID: ${result}`)
        } catch (error) {
            console.log(`   ❌ FAILED: ${error.message}`)
            console.log(`   Error code: ${error.code}`)
            
            if (error.code === 'messaging/registration-token-not-registered') {
                console.log(`   ⚠️  This token is invalid/expired. Should be removed.`)
            }
        }
    }

    console.log('\n' + '='.repeat(60))
    console.log('✅ Test complete!')
    console.log('='.repeat(60))

    await mongoose.disconnect()
}

main().catch(console.error)
