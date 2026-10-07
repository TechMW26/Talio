'use client'

import { NativeTable } from '@/components/ui/fernly'

import { Heading1, Heading2, NativeButton, Heading3 } from '@/components/ui/fernly/native'
import { useEffect, useState, useMemo } from 'react'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'

export default function FCMDiagnosticPage() {
    const [diagnostics, setDiagnostics] = useState({
        hasAndroidFCM: false,
        token: null,
        permissions: null,
        userId: null,
        registrationStatus: null
    })

    // Mutation: register token
    const registerMutation = useApiMutation({
        method: 'POST',
        onSuccess: (data) => {
            setDiagnostics(prev => ({
                ...prev,
                registrationStatus: 'Registered \u2705'
            }))
        },
        onError: (msg) => {
            setDiagnostics(prev => ({
                ...prev,
                registrationStatus: `Failed: ${msg}`
            }))
        }
    })

    // Mutation: send test notification
    const testMutation = useApiMutation({
        method: 'POST',
        onSuccess: (data) => alert(JSON.stringify(data, null, 2)),
        onError: (msg) => alert('Error: ' + msg),
    })

    // Mutation: clear tokens
    const clearMutation = useApiMutation({
        method: 'DELETE',
        onSuccess: (data) => {
            alert(data?.message || 'Tokens cleared')
            checkFCMStatus()
        },
        onError: (msg) => alert('Error: ' + msg),
    })

    useEffect(() => {
        checkFCMStatus()
    }, [])

    const checkFCMStatus = async () => {
        try {
            // Check if Android FCM interface exists
            const hasAndroidFCM = typeof window !== 'undefined' && window.AndroidFCM

            let token = null
            let permissions = null

            if (hasAndroidFCM) {
                // Get FCM token from Android
                token = window.AndroidFCM.getToken()
                console.log('Android FCM Token:', token)
            }

            // Get user info from localStorage
            const userStr = localStorage.getItem('user')
            const user = userStr ? JSON.parse(userStr) : null

            setDiagnostics({
                hasAndroidFCM,
                token,
                permissions: 'Check Android Settings',
                userId: user?._id || user?.id,
                userEmail: user?.email
            })

            // Try to register token if we have both
            if (token && user) {
                registerMutation.execute('/api/fcm/token', {
                    token,
                    platform: 'android',
                    deviceInfo: {
                        model: 'Android Device',
                        osVersion: 'Unknown'
                    }
                })
            }

        } catch (error) {
            console.error('Diagnostic error:', error)
        }
    }

    const sendTestNotification = () => {
        testMutation.execute('/api/test-notification', {
            userId: diagnostics.userId,
            type: 'message',
            customTitle: '🧪 Test Notification',
            customMessage: 'If you see this as a pop-up bubble, notifications are working!'
        })
    }

    const forceRegisterToken = () => {
        if (!window.AndroidFCM) {
            alert('Android FCM not available')
            return
        }

        try {
            const token = window.AndroidFCM.getToken()
            registerMutation.execute('/api/fcm/token', {
                token,
                platform: 'android',
                deviceInfo: {
                    model: 'Android Device',
                    osVersion: 'Unknown'
                }
            })
        } catch (error) {
            alert('Error: ' + error.message)
        }
    }

    return (
        <div style={{ padding: '20px', fontFamily: 'monospace' }}>
            <Heading1>🔍 FCM Diagnostic Tool</Heading1>

            <div style={{ background: '#f5f5f5', padding: '15px', marginTop: '20px', borderRadius: '8px' }}>
                <Heading2>Status</Heading2>
                <NativeTable style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                        <tr>
                            <td style={{ padding: '8px', borderBottom: '1px solid #ddd' }}><strong>Android FCM Interface:</strong></td>
                            <td style={{ padding: '8px', borderBottom: '1px solid #ddd' }}>{diagnostics.hasAndroidFCM ? '✅ Available' : '❌ Not Available'}</td>
                        </tr>
                        <tr>
                            <td style={{ padding: '8px', borderBottom: '1px solid #ddd' }}><strong>FCM Token:</strong></td>
                            <td style={{ padding: '8px', borderBottom: '1px solid #ddd', wordBreak: 'break-all' }}>
                                {diagnostics.token ? `${diagnostics.token.substring(0, 30)}...` : '❌ No Token'}
                            </td>
                        </tr>
                        <tr>
                            <td style={{ padding: '8px', borderBottom: '1px solid #ddd' }}><strong>User ID:</strong></td>
                            <td style={{ padding: '8px', borderBottom: '1px solid #ddd' }}>{diagnostics.userId || '❌ Not logged in'}</td>
                        </tr>
                        <tr>
                            <td style={{ padding: '8px', borderBottom: '1px solid #ddd' }}><strong>User Email:</strong></td>
                            <td style={{ padding: '8px', borderBottom: '1px solid #ddd' }}>{diagnostics.userEmail || 'N/A'}</td>
                        </tr>
                        <tr>
                            <td style={{ padding: '8px', borderBottom: '1px solid #ddd' }}><strong>Registration Status:</strong></td>
                            <td style={{ padding: '8px', borderBottom: '1px solid #ddd' }}>{diagnostics.registrationStatus || 'Not registered'}</td>
                        </tr>
                    </tbody>
                </NativeTable>
            </div>

            <div style={{ marginTop: '30px' }}>
                <Heading2>Actions</Heading2>
                <NativeButton
                    onClick={forceRegisterToken}
                    disabled={registerMutation.isLoading}
                    style={{
                        padding: '12px 24px',
                        background: registerMutation.isLoading ? '#9E9E9E' : '#4CAF50',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        marginRight: '10px',
                        marginBottom: '10px'
                    }}
                >
                    {registerMutation.isLoading ? '\u23f3 Registering...' : '\ud83d\udcdd Register FCM Token'}
                </NativeButton>

                <NativeButton
                    onClick={sendTestNotification}
                    disabled={testMutation.isLoading}
                    style={{
                        padding: '12px 24px',
                        background: testMutation.isLoading ? '#9E9E9E' : '#2196F3',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        marginRight: '10px',
                        marginBottom: '10px'
                    }}
                >
                    {testMutation.isLoading ? '\u23f3 Sending...' : '\ud83e\uddea Send Test Notification'}
                </NativeButton>

                <NativeButton
                    onClick={checkFCMStatus}
                    style={{
                        padding: '12px 24px',
                        background: '#FF9800',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        marginBottom: '10px'
                    }}
                >
                    🔄 Refresh Status
                </NativeButton>
            </div>

            <div style={{ marginTop: '30px', background: '#fff3cd', padding: '15px', borderRadius: '8px' }}>
                <Heading3>⚠️ Troubleshooting Steps:</Heading3>
                <ol>
                    <li><strong>Check Notification Permission:</strong> Go to Android Settings → Apps → Talio → Notifications → Make sure "All Talio notifications" is ON</li>
                    <li><strong>Check Battery Optimization:</strong> Settings → Apps → Talio → Battery → Unrestricted</li>
                    <li><strong>Register Token:</strong> Click "Register FCM Token" button above</li>
                    <li><strong>Test Notification:</strong> Click "Send Test Notification" - you should see a pop-up bubble</li>
                    <li><strong>Check Android Logs:</strong> Connect phone to PC → Run: <code>adb logcat | Select-String "FCM"</code></li>
                </ol>
            </div>

            <div style={{ marginTop: '20px', background: '#f8d7da', padding: '15px', borderRadius: '8px' }}>
                <Heading3>🗑️ Clear FCM Tokens from Database</Heading3>
                <p>If you want to start fresh, you can clear all FCM tokens and re-register.</p>
                <NativeButton
                    onClick={async () => {
                        if (!confirm('Are you sure you want to clear all FCM tokens? You will need to re-register.')) return
                        clearMutation.execute('/api/fcm/token', null, { method: 'DELETE' })
                    }}
                    disabled={clearMutation.isLoading}
                    style={{
                        padding: '12px 24px',
                        background: '#dc3545',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer'
                    }}
                >
                    🗑️ Clear All FCM Tokens
                </NativeButton>
            </div>
        </div>
    )
}
