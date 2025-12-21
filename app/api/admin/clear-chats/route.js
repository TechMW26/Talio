import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import connectDB from '@/lib/mongodb';
import mongoose from 'mongoose';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

/**
 * DELETE /api/admin/clear-chats
 * Clear all chat data (admin only)
 */
export async function DELETE(request) {
  try {
    await connectDB();

    // Verify JWT token
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized - No token provided' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const decoded = await jwtVerify(token, JWT_SECRET);
    
    // Only admin can clear all chats
    if (!['admin'].includes(decoded.payload.role)) {
      return NextResponse.json(
        { error: 'Forbidden - Admin access required' },
        { status: 403 }
      );
    }

    const db = mongoose.connection.db;

    // Delete all chats
    const chatsResult = await db.collection('chats').deleteMany({});
    
    // Delete all messages
    const messagesResult = await db.collection('messages').deleteMany({});

    console.log(`✅ Cleared ${chatsResult.deletedCount} chats and ${messagesResult.deletedCount} messages`);

    return NextResponse.json({
      success: true,
      message: 'All chat data cleared successfully',
      deletedChats: chatsResult.deletedCount,
      deletedMessages: messagesResult.deletedCount
    });

  } catch (error) {
    console.error('❌ Clear chats error:', error);
    return NextResponse.json(
      { error: 'Failed to clear chat data', details: error.message },
      { status: 500 }
    );
  }
}
