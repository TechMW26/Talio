import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';

/**
 * GET /api/setup/check
 * Check if initial setup is needed (no admin users exist in the database)
 * This is a public endpoint that doesn't require authentication
 */
export async function GET() {
  try {
    await connectDB();

    // Check if any admin users exist
    const adminCount = await User.countDocuments({
      role: { $in: ['admin', 'god_admin'] },
      isActive: true
    });

    const needsSetup = adminCount === 0;

    console.log(`[Setup Check] Admin count: ${adminCount}, Needs setup: ${needsSetup}`);

    return NextResponse.json({
      success: true,
      needsSetup,
      message: needsSetup 
        ? 'No admin users found. Initial setup required.' 
        : 'System is already configured.'
    });

  } catch (error) {
    console.error('[Setup Check] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to check setup status', error: error.message },
      { status: 500 }
    );
  }
}
