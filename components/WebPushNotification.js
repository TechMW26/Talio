'use client';

import { useState, useEffect, useCallback } from 'react';
import { Bell, BellOff, Check, X, Smartphone, Monitor, AlertCircle } from 'lucide-react';
import Loader from '@/components/ui/Loader';
import useWebPush from '@/hooks/useWebPush';

/**
 * Web Push Notification Permission Component
 * Shows a banner/modal prompting users to enable web push notifications
 * 
 * FIXED:
 * 1. Properly handles subscription state after enable
 * 2. Shows success state briefly before closing
 * 3. Handles errors gracefully without infinite loading
 */
export function WebPushPrompt({ onClose }) {
    const {
        isSupported,
        permission,
        isSubscribed,
        isLoading,
        error,
        isInitialized,
        subscribe
    } = useWebPush();

    const [dismissed, setDismissed] = useState(false);
    const [subscribeSuccess, setSubscribeSuccess] = useState(false);

    // Check if user has previously dismissed the prompt
    useEffect(() => {
        const wasDismissed = localStorage.getItem('webpush_prompt_dismissed');
        if (wasDismissed) {
            const dismissedTime = parseInt(wasDismissed, 10);
            // Show again after 7 days
            if (Date.now() - dismissedTime < 7 * 24 * 60 * 60 * 1000) {
                setDismissed(true);
            }
        }
    }, []);

    // Auto-close after successful subscription
    useEffect(() => {
        if (subscribeSuccess) {
            const timer = setTimeout(() => {
                onClose?.();
            }, 1500); // Show success state for 1.5 seconds
            return () => clearTimeout(timer);
        }
    }, [subscribeSuccess, onClose]);

    const handleEnable = useCallback(async () => {
        try {
            const result = await subscribe();
            if (result) {
                setSubscribeSuccess(true);
            }
        } catch (err) {
            console.error('[WebPushPrompt] Error enabling notifications:', err);
        }
    }, [subscribe]);

    const handleDismiss = useCallback(() => {
        localStorage.setItem('webpush_prompt_dismissed', Date.now().toString());
        setDismissed(true);
        onClose?.();
    }, [onClose]);

    // Don't show if not supported, already subscribed, permission denied, or dismissed
    // Wait for initialization before deciding to show
    // Don't show in Electron desktop app — it uses native notifications via DesktopNotificationPrompt
    const isElectronApp = typeof window !== 'undefined' && (window.isElectron === true || window.electronAPI !== undefined);
    if (isElectronApp || !isInitialized || !isSupported || isSubscribed || permission === 'denied' || dismissed || subscribeSuccess) {
        // Show success message briefly before disappearing
        if (subscribeSuccess) {
            return (
                <div className="fixed bottom-20 md:bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-[420px] z-50 animate-in slide-in-from-bottom-4 duration-300">
                    <div className="relative bg-white dark:bg-gray-800 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.3)] overflow-hidden">
                        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-green-500 via-green-600 to-emerald-600"></div>
                        <div className="px-8 py-10 text-center">
                            <div className="relative inline-flex items-center justify-center mb-6">
                                <div className="absolute inset-0 bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl blur-lg opacity-30"></div>
                                <div className="relative bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl p-4 shadow-lg">
                                    <Check className="w-7 h-7 text-white" strokeWidth={2.5} />
                                </div>
                            </div>
                            <h3 className="text-xl font-semibold text-slate-800 dark:text-black mb-3 tracking-tight">
                                Notifications Enabled!
                            </h3>
                            <p className="text-sm text-slate-500 dark:text-gray-400">
                                You'll now receive important updates.
                            </p>
                        </div>
                    </div>
                </div>
            );
        }
        return null;
    }

    return (
        <div className="fixed bottom-20 md:bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-[420px] z-50 animate-in slide-in-from-bottom-4 duration-300">
            {/* Main Card */}
            <div className="relative bg-white dark:bg-gray-800 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.3)] overflow-hidden">
                {/* Gradient Accent */}
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-blue-600 to-indigo-600"></div>

                {/* Close Button */}
                <button
                    onClick={handleDismiss}
                    className="absolute top-5 right-5 p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-gray-700 transition-colors duration-200 group"
                    aria-label="Close"
                >
                    <X className="w-4 h-4 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-gray-300" />
                </button>

                {/* Content Container */}
                <div className="px-8 py-10 text-center">
                    {/* Icon Container with Gradient Background */}
                    <div className="relative inline-flex items-center justify-center mb-6">
                        <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl blur-lg opacity-30"></div>
                        <div className="relative bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl p-4 shadow-lg">
                            <Bell className="w-7 h-7 text-white" strokeWidth={2.5} />
                        </div>
                    </div>

                    {/* Title */}
                    <h3 className="text-xl font-semibold text-slate-800 dark:text-black mb-3 tracking-tight">
                        Stay Updated
                    </h3>

                    {/* Description */}
                    <p className="text-sm text-slate-500 dark:text-gray-400 mb-8 leading-relaxed max-w-sm mx-auto">
                        Get instant alerts for leave approvals, attendance updates, tasks and more — even when you're not on this page.
                    </p>

                    {/* Error message */}
                    {error && (
                        <div className="mb-6 p-3 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-800">
                            <p className="text-xs text-red-600 dark:text-red-400 flex items-center justify-center gap-1.5">
                                <AlertCircle className="w-3.5 h-3.5" />
                                {error}
                            </p>
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex gap-3">
                        <button
                            onClick={handleEnable}
                            disabled={isLoading}
                            className="flex-1 bg-gradient-to-r from-blue-500 to-indigo-600 text-white py-3.5 rounded-xl font-medium shadow-[0_4px_12px_rgba(59,130,246,0.3)] hover:shadow-[0_6px_20px_rgba(59,130,246,0.4)] hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2"
                        >
                            {isLoading ? (
                                <>
                                    <Loader size="xs" />
                                    Enabling...
                                </>
                            ) : (
                                'Enable Notifications'
                            )}
                        </button>
                        <button
                            onClick={handleDismiss}
                            className="px-6 py-3.5 text-sm font-medium text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-gray-700 rounded-xl transition-all duration-200"
                        >
                            Later
                        </button>
                    </div>
                </div>
            </div>

            {/* Decorative Elements */}
            <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-gradient-to-br from-blue-400/20 to-indigo-500/20 rounded-full blur-2xl -z-10"></div>
            <div className="absolute -top-4 -left-4 w-32 h-32 bg-gradient-to-br from-indigo-400/20 to-blue-500/20 rounded-full blur-2xl -z-10"></div>
        </div>
    );
}

/**
 * Web Push Settings Component
 * For use in settings pages to manage notification preferences
 */
export function WebPushSettings() {
    const {
        isSupported,
        permission,
        isSubscribed,
        isLoading,
        error,
        subscribe,
        unsubscribe,
        sendTestNotification
    } = useWebPush();

    const [testSent, setTestSent] = useState(false);
    const [testLoading, setTestLoading] = useState(false);

    const handleToggle = async () => {
        if (isSubscribed) {
            await unsubscribe();
        } else {
            await subscribe();
        }
    };

    const handleTest = async () => {
        setTestLoading(true);
        setTestSent(false);

        const success = await sendTestNotification();

        if (success) {
            setTestSent(true);
            setTimeout(() => setTestSent(false), 3000);
        }

        setTestLoading(false);
    };

    if (!isSupported) {
        return (
            <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
                <div className="flex items-center gap-3">
                    <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
                    <div>
                        <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                            Browser Not Supported
                        </p>
                        <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                            Push notifications are not supported in this browser. Try using Chrome, Edge, or Firefox.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    if (permission === 'denied') {
        return (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                <div className="flex items-center gap-3">
                    <BellOff className="w-5 h-5 text-red-600 dark:text-red-400" />
                    <div>
                        <p className="text-sm font-medium text-red-800 dark:text-red-200">
                            Notifications Blocked
                        </p>
                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                            You've blocked notifications. To enable them, click the lock icon in your browser's address bar and allow notifications.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Main Toggle */}
            <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isSubscribed
                        ? 'bg-green-100 dark:bg-green-900/30'
                        : 'bg-gray-100 dark:bg-gray-700'
                        }`}>
                        {isSubscribed ? (
                            <Bell className="w-5 h-5 text-green-600 dark:text-green-400" />
                        ) : (
                            <BellOff className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                        )}
                    </div>
                    <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-black">
                            Browser Push Notifications
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            {isSubscribed
                                ? 'You will receive notifications in this browser'
                                : 'Enable to receive alerts even when not on this page'}
                        </p>
                    </div>
                </div>

                <button
                    onClick={handleToggle}
                    disabled={isLoading}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${isSubscribed ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600'
                        }`}
                >
                    <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${isSubscribed ? 'translate-x-5' : 'translate-x-0'
                            }`}
                    />
                </button>
            </div>

            {/* Error Message */}
            {error && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                    <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
                </div>
            )}

            {/* Test Button */}
            {isSubscribed && (
                <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                    <span className="text-sm text-blue-800 dark:text-blue-200">
                        Test your notification setup
                    </span>
                    <button
                        onClick={handleTest}
                        disabled={testLoading}
                        className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1"
                    >
                        {testLoading ? (
                            <>
                                <Loader size="xs" />
                                Sending...
                            </>
                        ) : testSent ? (
                            <>
                                <Check className="w-3 h-3" />
                                Sent!
                            </>
                        ) : (
                            'Send Test'
                        )}
                    </button>
                </div>
            )}

            {/* Platform Info */}
            <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                    Registered devices:
                </p>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                        <Monitor className="w-4 h-4" />
                        <span>Web: {isSubscribed ? '1' : '0'}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                        <Smartphone className="w-4 h-4" />
                        <span>Android: Check mobile app</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

/**
 * Notification Status Badge Component
 * Small indicator showing notification status
 */
export function NotificationStatusBadge() {
    const { isSupported, isSubscribed, permission } = useWebPush();

    if (!isSupported) return null;

    if (permission === 'denied') {
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-red-700 bg-red-100 dark:text-red-300 dark:bg-red-900/30 rounded-full">
                <BellOff className="w-3 h-3" />
                Blocked
            </span>
        );
    }

    if (isSubscribed) {
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-green-700 bg-green-100 dark:text-green-300 dark:bg-green-900/30 rounded-full">
                <Bell className="w-3 h-3" />
                Enabled
            </span>
        );
    }

    return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-gray-600 bg-gray-100 dark:text-gray-400 dark:bg-gray-700 rounded-full">
            <BellOff className="w-3 h-3" />
            Disabled
        </span>
    );
}

export default WebPushSettings;
