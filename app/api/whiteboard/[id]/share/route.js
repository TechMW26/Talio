import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth'
import { jwtVerify } from 'jose';
;
;
;

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'your-secret-key');

async function verifyAuth(request) {
  try {
    const token = request.cookies.get('token')?.value || 
                  request.headers.get('authorization')?.replace('Bearer ', '');
    
    if (!token) return null;
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return {
      id: payload.userId || payload.id,
      ...payload
    };
  } catch (error) {
    return null;
  }
}

// GET /api/whiteboard/[id]/share - Get sharing info
export async function GET(request, { params }) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Whiteboard', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Whiteboard, User } = models

    ;

    const whiteboard = await Whiteboard.findById(id)
      .select('owner sharing isPublic publicLink')
      .populate('sharing.userId', 'name email avatar')
      .populate('sharing.sharedBy', 'name email');

    if (!whiteboard) {
      return NextResponse.json({ error: 'Whiteboard not found' }, { status: 404 });
    }

    // Only owner or editors can see sharing info
    if (!whiteboard.hasPermission(user.id, 'editor')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    return NextResponse.json({
      sharing: whiteboard.sharing,
      isPublic: whiteboard.isPublic,
      publicLink: whiteboard.publicLink,
      isOwner: whiteboard.owner.toString() === user.id
    });
  } catch (error) {
    console.error('Error fetching sharing info:', error);
    return NextResponse.json({ error: 'Failed to fetch sharing info' }, { status: 500 });
  }
}

// POST /api/whiteboard/[id]/share - Add or update share
export async function POST(request, { params }) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    ;

    const whiteboard = await Whiteboard.findById(id);
    if (!whiteboard) {
      return NextResponse.json({ error: 'Whiteboard not found' }, { status: 404 });
    }

    // Only owner can share
    if (whiteboard.owner.toString() !== user.id) {
      return NextResponse.json({ error: 'Only the owner can share this whiteboard' }, { status: 403 });
    }

    const body = await request.json();
    const { email, userId, permission, isPublic, generatePublicLink } = body;

    // Handle public sharing
    if (isPublic !== undefined) {
      whiteboard.isPublic = isPublic;
      if (isPublic && !whiteboard.publicLink) {
        whiteboard.publicLink = Whiteboard.generatePublicLink();
      }
    }

    if (generatePublicLink) {
      whiteboard.publicLink = Whiteboard.generatePublicLink();
    }

    // Handle user sharing
    if (email || userId) {
      let targetUser;
      if (email) {
        targetUser = await User.findOne({ email: email.toLowerCase() });
        if (!targetUser) {
          return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }
      } else {
        targetUser = await User.findById(userId);
        if (!targetUser) {
          return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }
      }

      // Can't share with yourself
      if (targetUser._id.toString() === user.id) {
        return NextResponse.json({ error: 'Cannot share with yourself' }, { status: 400 });
      }

      // Check if already shared
      const existingShare = whiteboard.sharing.find(
        s => s.userId.toString() === targetUser._id.toString()
      );

      if (existingShare) {
        existingShare.permission = permission || 'view_only';
      } else {
        whiteboard.sharing.push({
          userId: targetUser._id,
          permission: permission || 'view_only',
          sharedBy: user.id,
          sharedAt: new Date()
        });
      }
    }

    await whiteboard.save();

    // Fetch updated sharing info
    const updatedWhiteboard = await Whiteboard.findById(id)
      .select('sharing isPublic publicLink')
      .populate('sharing.userId', 'name email avatar');

    return NextResponse.json({
      success: true,
      sharing: updatedWhiteboard.sharing,
      isPublic: updatedWhiteboard.isPublic,
      publicLink: updatedWhiteboard.publicLink
    });
  } catch (error) {
    console.error('Error sharing whiteboard:', error);
    return NextResponse.json({ error: 'Failed to share whiteboard' }, { status: 500 });
  }
}

// DELETE /api/whiteboard/[id]/share - Remove share
export async function DELETE(request, { params }) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const userIdToRemove = searchParams.get('userId');

    ;

    const whiteboard = await Whiteboard.findById(id);
    if (!whiteboard) {
      return NextResponse.json({ error: 'Whiteboard not found' }, { status: 404 });
    }

    // Only owner can remove shares
    if (whiteboard.owner.toString() !== user.id) {
      return NextResponse.json({ error: 'Only the owner can modify sharing' }, { status: 403 });
    }

    if (userIdToRemove) {
      whiteboard.sharing = whiteboard.sharing.filter(
        s => s.userId.toString() !== userIdToRemove
      );
      await whiteboard.save();
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error removing share:', error);
    return NextResponse.json({ error: 'Failed to remove share' }, { status: 500 });
  }
}
