import { NextResponse } from 'next/server';
import { PREBUILT_MESSAGES, getMessagesByCategory } from '@/lib/audio';

/**
 * GET /api/call-alert/templates
 * Get prebuilt message templates
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');

    const templates = category ? getMessagesByCategory(category) : PREBUILT_MESSAGES;

    // Get unique categories
    const categories = [...new Set(PREBUILT_MESSAGES.map(t => t.category))];

    return NextResponse.json({
      success: true,
      data: {
        templates,
        categories: ['all', ...categories],
        placeholders: [
          { key: '{senderName}', description: 'Name of the person sending the alert' },
          { key: '{senderRole}', description: 'Role of the sender (e.g., Administrator, Department Head)' },
          { key: '{receiverName}', description: 'Name of the person receiving the alert' },
          { key: '{receiverDepartment}', description: 'Department of the receiver' },
          { key: '{companyName}', description: 'Company name' },
          { key: '{time}', description: 'Current time' },
          { key: '{date}', description: 'Current date' }
        ]
      }
    });

  } catch (error) {
    console.error('[CallAlert] Error fetching templates:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch templates', error: error.message },
      { status: 500 }
    );
  }
}
