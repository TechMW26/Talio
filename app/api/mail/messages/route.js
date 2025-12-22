import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import EmailAccount from '@/models/EmailAccount';
import { google } from 'googleapis';

// Production URL and redirect URI - must match Google Cloud Console
const PRODUCTION_URL = 'https://app.talio.in';
const REDIRECT_URI = `${PRODUCTION_URL}/api/auth/google/callback`;

// Custom label name for snoozed emails (Gmail doesn't expose native snooze via API)
const SNOOZED_LABEL_NAME = 'Talio/Snoozed';

// Get or create the custom snoozed label
async function getOrCreateSnoozedLabel(gmail) {
  try {
    // First, try to find existing label
    const labelsResponse = await gmail.users.labels.list({ userId: 'me' });
    const labels = labelsResponse.data.labels || [];
    const existingLabel = labels.find(l => l.name === SNOOZED_LABEL_NAME);

    if (existingLabel) {
      return existingLabel.id;
    }

    // Create the label if it doesn't exist
    const createResponse = await gmail.users.labels.create({
      userId: 'me',
      requestBody: {
        name: SNOOZED_LABEL_NAME,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show'
      }
    });

    return createResponse.data.id;
  } catch (error) {
    console.error('Error getting/creating snoozed label:', error);
    return null;
  }
}

// Create OAuth2 client with user's tokens
async function getAuthenticatedClient(emailAccount) {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

  oauth2Client.setCredentials({
    access_token: emailAccount.accessToken,
    refresh_token: emailAccount.refreshToken,
    expiry_date: emailAccount.tokenExpiry?.getTime()
  });

  // Check if token needs refresh
  if (emailAccount.tokenExpiry && new Date() >= emailAccount.tokenExpiry) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      emailAccount.accessToken = credentials.access_token;
      emailAccount.tokenExpiry = new Date(credentials.expiry_date);
      await emailAccount.save();
    } catch (error) {
      console.error('Error refreshing token:', error);
      throw new Error('Token refresh failed');
    }
  }

  return oauth2Client;
}

// Parse email address from Gmail format
function parseEmailAddress(str) {
  if (!str) return { name: '', email: '' };
  const match = str.match(/^(?:(.+?)\s*)?<?([^<>\s]+@[^<>\s]+)>?$/);
  if (match) {
    return { name: match[1]?.trim() || '', email: match[2] };
  }
  return { name: '', email: str };
}

// GET - Fetch emails
export async function GET(request) {
  try {
    const token = request.headers.get('Authorization')?.split(' ')[1];
    
    if (!token) {
      return NextResponse.json({ 
        emails: [], 
        nextPageToken: null,
        unreadCount: 0
      });
    }
    
    const payload = await verifyToken(token);

    if (!payload) {
      return NextResponse.json({ 
        emails: [], 
        nextPageToken: null,
        unreadCount: 0
      });
    }

    const { searchParams } = new URL(request.url);
    const folder = searchParams.get('folder') || 'inbox';
    const pageToken = searchParams.get('pageToken') || null;
    const maxResults = parseInt(searchParams.get('maxResults')) || 20;
    const accountId = searchParams.get('accountId'); // Optional: specific account ID
    const allAccounts = searchParams.get('allAccounts') === 'true'; // Fetch from all accounts

    await connectDB();

    // Get email accounts
    let emailAccounts;
    if (accountId) {
      // Fetch specific account
      const account = await EmailAccount.findOne({ _id: accountId, user: payload.userId }).select('+accessToken +refreshToken');
      emailAccounts = account ? [account] : [];
    } else if (allAccounts) {
      // Fetch from all connected accounts
      emailAccounts = await EmailAccount.find({ user: payload.userId, isConnected: true }).select('+accessToken +refreshToken');
    } else {
      // Fetch from primary account or first available
      const accounts = await EmailAccount.find({ user: payload.userId, isConnected: true }).select('+accessToken +refreshToken');
      const primary = accounts.find(a => a.isPrimary) || accounts[0];
      emailAccounts = primary ? [primary] : [];
    }

    if (!emailAccounts || emailAccounts.length === 0) {
      return NextResponse.json({ 
        emails: [], 
        nextPageToken: null,
        unreadCount: 0
      });
    }

    // Map folder to Gmail label (snoozed is handled specially below)
    const labelMap = {
      inbox: 'INBOX',
      sent: 'SENT',
      drafts: 'DRAFT',
      trash: 'TRASH',
      spam: 'SPAM',
      starred: 'STARRED',
      important: 'IMPORTANT',
      snoozed: null, // Will be resolved to custom label ID
      all: null // All mail - no specific label filter
    };

    let labelId = labelMap[folder];

    // Collect emails from all accounts
    let allEmails = [];
    let totalUnreadCount = 0;
    let totalSpamCount = 0;
    let lastNextPageToken = null;

    for (const emailAccount of emailAccounts) {
      try {
        const oauth2Client = await getAuthenticatedClient(emailAccount);
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        // For snoozed folder, get the custom label ID
        let queryLabelId = labelId;
        if (folder === 'snoozed') {
          queryLabelId = await getOrCreateSnoozedLabel(gmail);
        }

        // Build query parameters
        const queryParams = {
          userId: 'me',
          maxResults: allAccounts ? Math.ceil(maxResults / emailAccounts.length) : maxResults,
          pageToken: pageToken
        };

        // Only add labelIds if we have a specific label (not 'all')
        if (queryLabelId !== null && queryLabelId !== undefined) {
          queryParams.labelIds = [queryLabelId];
        }

        // Fetch message list
        const listResponse = await gmail.users.messages.list(queryParams);

        const messages = listResponse.data.messages || [];
        lastNextPageToken = listResponse.data.nextPageToken || lastNextPageToken;

        // Fetch full message details for each
        const emailPromises = messages.map(async (msg) => {
          const messageResponse = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: 'full'
          });

          const message = messageResponse.data;
          const headers = message.payload?.headers || [];

          const getHeader = (name) => {
            const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
            return header?.value || '';
          };

          // Get email body
          let body = '';
          let bodyHtml = '';

          function extractBody(payload) {
            if (payload.body?.data) {
              const decodedBody = Buffer.from(payload.body.data, 'base64').toString('utf-8');
              if (payload.mimeType === 'text/html') {
                bodyHtml = decodedBody;
              } else {
                body = decodedBody;
              }
            }
            if (payload.parts) {
              payload.parts.forEach(extractBody);
            }
          }

          extractBody(message.payload);

          // Get attachments info
          const attachments = [];
          function extractAttachments(payload) {
            if (payload.filename && payload.body?.attachmentId) {
              attachments.push({
                filename: payload.filename,
                mimeType: payload.mimeType,
                size: payload.body.size,
                attachmentId: payload.body.attachmentId
              });
            }
            if (payload.parts) {
              payload.parts.forEach(extractAttachments);
            }
          }
          extractAttachments(message.payload);

          return {
            messageId: message.id,
            threadId: message.threadId,
            from: parseEmailAddress(getHeader('From')),
            to: getHeader('To').split(',').map(e => parseEmailAddress(e.trim())),
            cc: getHeader('Cc') ? getHeader('Cc').split(',').map(e => parseEmailAddress(e.trim())) : [],
            subject: getHeader('Subject') || '(No Subject)',
            snippet: message.snippet,
            body: body,
            bodyHtml: bodyHtml,
            date: new Date(parseInt(message.internalDate)),
            isRead: !message.labelIds?.includes('UNREAD'),
            isStarred: message.labelIds?.includes('STARRED'),
            labels: message.labelIds || [],
            attachments: attachments,
            folder: folder,
            accountEmail: emailAccount.email,
            accountId: emailAccount._id.toString()
          };
        });

        const emails = await Promise.all(emailPromises);
        allEmails = [...allEmails, ...emails];

        // Update unread count and spam count for this account
        const [unreadResponse, spamResponse] = await Promise.all([
          gmail.users.messages.list({
            userId: 'me',
            labelIds: ['INBOX', 'UNREAD'],
            maxResults: 1
          }),
          gmail.users.messages.list({
            userId: 'me',
            labelIds: ['SPAM'],
            maxResults: 1
          })
        ]);

        const accountUnreadCount = unreadResponse.data.resultSizeEstimate || 0;
        const accountSpamCount = spamResponse.data.resultSizeEstimate || 0;

        emailAccount.unreadCount = accountUnreadCount;
        emailAccount.spamCount = accountSpamCount;
        emailAccount.lastSynced = new Date();
        await emailAccount.save();

        totalUnreadCount += accountUnreadCount;
        totalSpamCount += accountSpamCount;

      } catch (accountError) {
        console.error(`Error fetching from account ${emailAccount.email}:`, accountError);
        // Continue with other accounts
      }
    }

    // Sort all emails by date (newest first)
    allEmails.sort((a, b) => new Date(b.date) - new Date(a.date));

    return NextResponse.json({
      emails: allEmails,
      nextPageToken: lastNextPageToken,
      unreadCount: totalUnreadCount,
      spamCount: totalSpamCount
    });

  } catch (error) {
    console.error('[Mail Messages API] Error fetching emails:', error.message);

    // Return empty data instead of error to prevent UI issues
    return NextResponse.json({ 
      emails: [], 
      nextPageToken: null,
      unreadCount: 0,
      error: error.message === 'Token refresh failed' 
        ? 'Session expired. Please reconnect your email.' 
        : 'Failed to fetch emails'
    });
  }
}

// POST - Send email
export async function POST(request) {
  try {
    const token = request.headers.get('Authorization')?.split(' ')[1];
    const payload = await verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { to, cc, bcc, subject, body, isHtml, attachments } = await request.json();

    if (!to || !subject) {
      return NextResponse.json({ error: 'To and subject are required' }, { status: 400 });
    }

    await connectDB();

    const emailAccount = await EmailAccount.findOne({ user: payload.userId }).select('+accessToken +refreshToken');

    if (!emailAccount || !emailAccount.isConnected) {
      return NextResponse.json({ error: 'Email not connected' }, { status: 400 });
    }

    const oauth2Client = await getAuthenticatedClient(emailAccount);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Generate boundary for multipart message
    const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    let emailContent = '';

    // Build headers
    emailContent += `From: ${emailAccount.email}\r\n`;
    emailContent += `To: ${Array.isArray(to) ? to.join(', ') : to}\r\n`;
    if (cc) emailContent += `Cc: ${Array.isArray(cc) ? cc.join(', ') : cc}\r\n`;
    if (bcc) emailContent += `Bcc: ${Array.isArray(bcc) ? bcc.join(', ') : bcc}\r\n`;
    emailContent += `Subject: ${subject}\r\n`;
    emailContent += `MIME-Version: 1.0\r\n`;

    // Check if we have attachments
    if (attachments && attachments.length > 0) {
      // Multipart message with attachments
      emailContent += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`;

      // Email body part
      emailContent += `--${boundary}\r\n`;
      emailContent += `Content-Type: ${isHtml ? 'text/html' : 'text/plain'}; charset=utf-8\r\n`;
      emailContent += `Content-Transfer-Encoding: base64\r\n\r\n`;
      emailContent += Buffer.from(body || '').toString('base64') + '\r\n';

      // Attachment parts
      for (const attachment of attachments) {
        emailContent += `--${boundary}\r\n`;
        emailContent += `Content-Type: ${attachment.contentType || 'application/octet-stream'}\r\n`;
        emailContent += `Content-Transfer-Encoding: base64\r\n`;
        emailContent += `Content-Disposition: attachment; filename="${attachment.filename}"\r\n\r\n`;
        emailContent += attachment.content + '\r\n';
      }

      // Close boundary
      emailContent += `--${boundary}--\r\n`;
    } else {
      // Simple message without attachments
      emailContent += `Content-Type: ${isHtml ? 'text/html' : 'text/plain'}; charset=utf-8\r\n`;
      emailContent += `Content-Transfer-Encoding: base64\r\n\r\n`;
      emailContent += Buffer.from(body || '').toString('base64');
    }

    const encodedMessage = Buffer.from(emailContent)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage
      }
    });

    return NextResponse.json({
      success: true,
      messageId: response.data.id
    });

  } catch (error) {
    console.error('Error sending email:', error);
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
  }
}

// PATCH - Mark email as read/unread or starred/unstarred
export async function PATCH(request) {
  try {
    const token = request.headers.get('Authorization')?.split(' ')[1];
    const payload = await verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { messageId, action } = await request.json();

    if (!messageId || !action) {
      return NextResponse.json({ error: 'Message ID and action are required' }, { status: 400 });
    }

    await connectDB();

    const emailAccount = await EmailAccount.findOne({ user: payload.userId }).select('+accessToken +refreshToken');

    if (!emailAccount || !emailAccount.isConnected) {
      return NextResponse.json({ error: 'Email not connected' }, { status: 400 });
    }

    const oauth2Client = await getAuthenticatedClient(emailAccount);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    let addLabelIds = [];
    let removeLabelIds = [];

    // For snooze/unsnooze, we need to get the custom label ID
    let snoozedLabelId = null;
    if (action === 'snooze' || action === 'unsnooze') {
      snoozedLabelId = await getOrCreateSnoozedLabel(gmail);
      if (!snoozedLabelId) {
        return NextResponse.json({ error: 'Failed to create snoozed label' }, { status: 500 });
      }
    }

    switch (action) {
      case 'markRead':
        removeLabelIds = ['UNREAD'];
        break;
      case 'markUnread':
        addLabelIds = ['UNREAD'];
        break;
      case 'star':
        addLabelIds = ['STARRED'];
        break;
      case 'unstar':
        removeLabelIds = ['STARRED'];
        break;
      case 'archive':
        removeLabelIds = ['INBOX'];
        break;
      case 'trash':
        addLabelIds = ['TRASH'];
        removeLabelIds = ['INBOX'];
        break;
      case 'untrash':
        removeLabelIds = ['TRASH'];
        addLabelIds = ['INBOX'];
        break;
      case 'snooze':
        // Add custom snoozed label and remove from inbox
        addLabelIds = [snoozedLabelId];
        removeLabelIds = ['INBOX'];
        break;
      case 'unsnooze':
        // Remove snoozed label and return to inbox
        removeLabelIds = [snoozedLabelId];
        addLabelIds = ['INBOX'];
        break;
      case 'markImportant':
        addLabelIds = ['IMPORTANT'];
        break;
      case 'unmarkImportant':
        removeLabelIds = ['IMPORTANT'];
        break;
      case 'spam':
        addLabelIds = ['SPAM'];
        removeLabelIds = ['INBOX'];
        break;
      case 'notSpam':
        removeLabelIds = ['SPAM'];
        addLabelIds = ['INBOX'];
        break;
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        addLabelIds,
        removeLabelIds
      }
    });

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error modifying email:', error);
    return NextResponse.json({ error: 'Failed to modify email' }, { status: 500 });
  }
}

// DELETE - Delete email permanently
export async function DELETE(request) {
  try {
    const token = request.headers.get('Authorization')?.split(' ')[1];
    const payload = await verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const messageId = searchParams.get('messageId');

    if (!messageId) {
      return NextResponse.json({ error: 'Message ID is required' }, { status: 400 });
    }

    await connectDB();

    const emailAccount = await EmailAccount.findOne({ user: payload.userId }).select('+accessToken +refreshToken');

    if (!emailAccount || !emailAccount.isConnected) {
      return NextResponse.json({ error: 'Email not connected' }, { status: 400 });
    }

    const oauth2Client = await getAuthenticatedClient(emailAccount);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    await gmail.users.messages.delete({
      userId: 'me',
      id: messageId
    });

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error deleting email:', error);
    return NextResponse.json({ error: 'Failed to delete email' }, { status: 500 });
  }
}
