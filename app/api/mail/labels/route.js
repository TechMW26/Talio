import { NextResponse } from 'next/server';
import { getAuthAndDatabase } from '@/lib/auth';
import { MAIL_ACCOUNT_OPTIONS, listMailAccounts, getMailAccount, updateMailAccount, disconnectMailAccount, getAuthenticatedMailClient } from '@/lib/mailAccounts.server';
import { google } from 'googleapis';

// Production URL and redirect URI - must match Google Cloud Console
const PRODUCTION_URL = 'https://app.talio.in';
const REDIRECT_URI = `${PRODUCTION_URL}/api/auth/google/callback`;

// Create OAuth2 client with user's tokens


// GET - Fetch all labels with message counts
export async function GET(request) {
    try {
        // Get authenticated user and tenant-specific models
        const auth = await getAuthAndDatabase(request, MAIL_ACCOUNT_OPTIONS)
        if (!auth.success) {
            return NextResponse.json({ 
                folderCounts: {},
                userLabels: []
            });
        }
        const { user, database } = auth

        const emailAccount = await getMailAccount(database, user);

        if (!emailAccount) {
            // Return empty labels when not connected
            return NextResponse.json({ 
                folderCounts: {},
                userLabels: []
            });
        }

        const oauth2Client = await getAuthenticatedMailClient(database, user, emailAccount);
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        // Fetch all labels
        const labelsResponse = await gmail.users.labels.list({ userId: 'me' });
        const labels = labelsResponse.data.labels || [];

        // Fetch detailed info for each label (includes message counts)
        const labelDetails = await Promise.all(
            labels.map(async (label) => {
                try {
                    const labelInfo = await gmail.users.labels.get({
                        userId: 'me',
                        id: label.id
                    });

                    return {
                        id: labelInfo.data.id,
                        name: labelInfo.data.name,
                        type: labelInfo.data.type, // 'system' or 'user'
                        messagesTotal: labelInfo.data.messagesTotal || 0,
                        messagesUnread: labelInfo.data.messagesUnread || 0,
                        threadsTotal: labelInfo.data.threadsTotal || 0,
                        threadsUnread: labelInfo.data.threadsUnread || 0,
                        color: labelInfo.data.color || null
                    };
                } catch (err) {
                    console.error(`Error fetching label ${label.id}:`, err);
                    return {
                        id: label.id,
                        name: label.name,
                        type: label.type,
                        messagesTotal: 0,
                        messagesUnread: 0,
                        threadsTotal: 0,
                        threadsUnread: 0
                    };
                }
            })
        );

        // Separate system and user labels
        const systemLabels = labelDetails.filter(l => l.type === 'system');
        const userLabels = labelDetails.filter(l => l.type === 'user');

        // Find our custom snoozed label
        const snoozedLabel = userLabels.find(l => l.name === 'Talio/Snoozed') || { messagesTotal: 0, messagesUnread: 0 };

        // Map system labels to our folder structure
        const folderCounts = {
            inbox: systemLabels.find(l => l.id === 'INBOX') || { messagesTotal: 0, messagesUnread: 0 },
            sent: systemLabels.find(l => l.id === 'SENT') || { messagesTotal: 0, messagesUnread: 0 },
            drafts: systemLabels.find(l => l.id === 'DRAFT') || { messagesTotal: 0, messagesUnread: 0 },
            trash: systemLabels.find(l => l.id === 'TRASH') || { messagesTotal: 0, messagesUnread: 0 },
            spam: systemLabels.find(l => l.id === 'SPAM') || { messagesTotal: 0, messagesUnread: 0 },
            starred: systemLabels.find(l => l.id === 'STARRED') || { messagesTotal: 0, messagesUnread: 0 },
            important: systemLabels.find(l => l.id === 'IMPORTANT') || { messagesTotal: 0, messagesUnread: 0 },
            snoozed: snoozedLabel, // Use our custom snoozed label
        };

        // Filter out our Talio/Snoozed label from user labels shown to user
        const filteredUserLabels = userLabels.filter(l => l.name !== 'Talio/Snoozed');

        return NextResponse.json({
            folderCounts: {
                inbox: { total: folderCounts.inbox.messagesTotal, unread: folderCounts.inbox.messagesUnread },
                sent: { total: folderCounts.sent.messagesTotal, unread: folderCounts.sent.messagesUnread },
                drafts: { total: folderCounts.drafts.messagesTotal, unread: folderCounts.drafts.messagesUnread },
                trash: { total: folderCounts.trash.messagesTotal, unread: folderCounts.trash.messagesUnread },
                spam: { total: folderCounts.spam.messagesTotal, unread: folderCounts.spam.messagesUnread },
                starred: { total: folderCounts.starred.messagesTotal, unread: folderCounts.starred.messagesUnread },
                important: { total: folderCounts.important.messagesTotal, unread: folderCounts.important.messagesUnread },
                snoozed: { total: folderCounts.snoozed.messagesTotal, unread: folderCounts.snoozed.messagesUnread },
            },
            userLabels: filteredUserLabels.map(l => ({
                id: l.id,
                name: l.name,
                messagesTotal: l.messagesTotal,
                messagesUnread: l.messagesUnread,
                color: l.color
            })),
            systemLabels: systemLabels.map(l => ({
                id: l.id,
                name: l.name,
                messagesTotal: l.messagesTotal,
                messagesUnread: l.messagesUnread
            }))
        });

    } catch (error) {
        console.error('[Mail Labels API] Error fetching labels:', error.message);

        // Return empty data instead of error to prevent UI issues
        return NextResponse.json({ 
            folderCounts: {},
            userLabels: [],
            error: error.message === 'Token refresh failed' 
                ? 'Session expired. Please reconnect your email.' 
                : 'Failed to fetch labels'
        });
    }
}

// POST - Create a new label
export async function POST(request) {
    try {
        const auth = await getAuthAndDatabase(request, MAIL_ACCOUNT_OPTIONS);
        if (!auth.success) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const { database, user } = auth;

        const { name, backgroundColor, textColor } = await request.json();

        if (!name) {
            return NextResponse.json({ error: 'Label name is required' }, { status: 400 });
        }

        const emailAccount = await getMailAccount(database, user);

        if (!emailAccount) {
            return NextResponse.json({ error: 'Email not connected' }, { status: 400 });
        }

        const oauth2Client = await getAuthenticatedMailClient(database, user, emailAccount);
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        const labelRequest = {
            name,
            labelListVisibility: 'labelShow',
            messageListVisibility: 'show'
        };

        // Add color if provided
        if (backgroundColor || textColor) {
            labelRequest.color = {
                backgroundColor: backgroundColor || '#000000',
                textColor: textColor || '#ffffff'
            };
        }

        const response = await gmail.users.labels.create({
            userId: 'me',
            requestBody: labelRequest
        });

        return NextResponse.json({
            success: true,
            label: {
                id: response.data.id,
                name: response.data.name,
                color: response.data.color
            }
        });

    } catch (error) {
        console.error('Error creating label:', error);
        return NextResponse.json({ error: error.message || 'Failed to create label' }, { status: 500 });
    }
}

// DELETE - Delete a label
export async function DELETE(request) {
    try {
        const auth = await getAuthAndDatabase(request, MAIL_ACCOUNT_OPTIONS);
        if (!auth.success) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const { database, user } = auth;

        const { searchParams } = new URL(request.url);
        const labelId = searchParams.get('labelId');

        if (!labelId) {
            return NextResponse.json({ error: 'Label ID is required' }, { status: 400 });
        }

        const emailAccount = await getMailAccount(database, user);

        if (!emailAccount) {
            return NextResponse.json({ error: 'Email not connected' }, { status: 400 });
        }

        const oauth2Client = await getAuthenticatedMailClient(database, user, emailAccount);
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        await gmail.users.labels.delete({
            userId: 'me',
            id: labelId
        });

        return NextResponse.json({ success: true });

    } catch (error) {
        console.error('Error deleting label:', error);
        return NextResponse.json({ error: error.message || 'Failed to delete label' }, { status: 500 });
    }
}
