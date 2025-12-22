import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import EmailAccount from '@/models/EmailAccount';

// Production URL - must match Google Cloud Console
const PRODUCTION_URL = 'https://app.talio.in';

// The SAME redirect URI that's already whitelisted for Google Sign-In
const REDIRECT_URI = `${PRODUCTION_URL}/api/auth/google/callback`;

// GET - Check if email is connected and get email account info
export async function GET(request) {
  try {
    const token = request.headers.get('Authorization')?.split(' ')[1];
    const payload = await verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB();

    // Get all connected email accounts for this user
    const emailAccounts = await EmailAccount.find({ user: payload.userId, isConnected: true });

    if (!emailAccounts || emailAccounts.length === 0) {
      return NextResponse.json({
        isConnected: false,
        email: null,
        accounts: []
      });
    }

    // Find the primary account or use the first one
    const primaryAccount = emailAccounts.find(acc => acc.isPrimary) || emailAccounts[0];

    // Calculate total counts across all accounts
    const totalUnreadCount = emailAccounts.reduce((sum, acc) => sum + (acc.unreadCount || 0), 0);
    const totalSpamCount = emailAccounts.reduce((sum, acc) => sum + (acc.spamCount || 0), 0);

    return NextResponse.json({
      isConnected: true,
      email: primaryAccount.email,
      provider: primaryAccount.provider,
      lastSynced: primaryAccount.lastSynced,
      unreadCount: totalUnreadCount,
      spamCount: totalSpamCount,
      settings: primaryAccount.settings,
      accounts: emailAccounts.map(acc => ({
        id: acc._id,
        email: acc.email,
        provider: acc.provider,
        isPrimary: acc.isPrimary,
        unreadCount: acc.unreadCount || 0,
        spamCount: acc.spamCount || 0,
        lastSynced: acc.lastSynced
      })),
      activeAccountId: primaryAccount._id
    });

  } catch (error) {
    console.error('Error getting email account:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// POST - Generate OAuth URL for Gmail connection
export async function POST(request) {
  try {
    const token = request.headers.get('Authorization')?.split(' ')[1];
    
    if (!token) {
      console.error('[Mail OAuth] No token provided');
      return NextResponse.json({ error: 'No authentication token provided' }, { status: 401 });
    }
    
    const payload = await verifyToken(token);

    if (!payload) {
      console.error('[Mail OAuth] Token verification failed');
      return NextResponse.json({ error: 'Unauthorized - invalid token' }, { status: 401 });
    }

    const clientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId) {
      console.error('[Mail OAuth] GOOGLE_CLIENT_ID not configured');
      return NextResponse.json({ error: 'Google OAuth client ID not configured' }, { status: 500 });
    }

    if (!clientSecret) {
      console.error('[Mail OAuth] GOOGLE_CLIENT_SECRET not configured');
      return NextResponse.json({ error: 'Google OAuth client secret not configured' }, { status: 500 });
    }

    // Generate a state token to identify this as a mail connection request
    const stateData = JSON.stringify({
      type: 'mail_connect',  // This tells the callback it's for mail
      userId: payload.userId,
      timestamp: Date.now()
    });
    // Use Buffer.from which is available in Node.js runtime
    const state = Buffer.from(stateData).toString('base64url');

    // Gmail scopes for reading, sending, and modifying emails
    const scopes = [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify'
    ];

    // Build the OAuth URL manually - same pattern as login page
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${clientId}&` +
      `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
      `response_type=code&` +
      `scope=${encodeURIComponent(scopes.join(' '))}&` +
      `access_type=offline&` +
      `prompt=consent&` +
      `state=${encodeURIComponent(state)}`;

    console.log('[Mail OAuth] Generated auth URL with redirect:', REDIRECT_URI);

    return NextResponse.json({ authUrl, state });

  } catch (error) {
    console.error('[Mail OAuth] Error generating auth URL:', error.message, error.stack);
    return NextResponse.json({ 
      error: 'Server error while generating OAuth URL',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    }, { status: 500 });
  }
}

// DELETE - Disconnect email account
export async function DELETE(request) {
  try {
    const token = request.headers.get('Authorization')?.split(' ')[1];
    const payload = await verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB();

    // Remove email account
    await EmailAccount.findOneAndDelete({ user: payload.userId });

    return NextResponse.json({ success: true, message: 'Email disconnected successfully' });

  } catch (error) {
    console.error('Error disconnecting email:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
