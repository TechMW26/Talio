import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import { getTenantConnection } from '@/lib/tenantDb';

/**
 * DELETE /api/admin/clear-chats
 * Clear all chat data (admin only)
 */
export async function DELETE(request) {
  try {
    // Get authenticated user and tenant info
    const auth = await getAuthAndModels(request, ['Chat'])
    if (!auth.success) {
      return NextResponse.json({ error: auth.message }, { status: 401 })
    }
    const { user, tenant } = auth
    
    // Only admin can clear all chats
    if (!['admin'].includes(user.role)) {
      return NextResponse.json(
        { error: 'Forbidden - Admin access required' },
        { status: 403 }
      );
    }

    // Get tenant database connection
    const connection = await getTenantConnection(tenant.databaseName);
    const db = connection.db;

    // Delete all chats
    const chatsResult = await db.collection('chats').deleteMany({});
    
    // Delete all messages (if stored separately)
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
