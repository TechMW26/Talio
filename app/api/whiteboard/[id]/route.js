import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import connectDB from '@/lib/mongodb';
import Whiteboard from '@/models/Whiteboard';
import { uploadImageToImageKit, deleteFromImageKit, getImageKitFolder } from '@/lib/imagekit';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'your-secret-key');

// Check if ImageKit is configured
const isImageKitConfigured = () => {
  return !!(
    process.env.IMAGEKIT_PUBLIC_KEY &&
    process.env.IMAGEKIT_PRIVATE_KEY &&
    process.env.IMAGEKIT_URL_ENDPOINT
  )
}

async function verifyAuth(request) {
  try {
    const token = request.cookies.get('token')?.value ||
      request.headers.get('authorization')?.replace('Bearer ', '');

    if (!token) {
      return null;
    }

    const { payload } = await jwtVerify(token, JWT_SECRET);
    return {
      id: payload.userId || payload.id,
      ...payload
    };
  } catch (error) {
    console.error('Auth verification failed:', error);
    return null;
  }
}

// GET /api/whiteboard/[id] - Get single whiteboard
export async function GET(request, { params }) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    await connectDB();

    const whiteboard = await Whiteboard.findById(id)
      .populate('owner', 'name email avatar')
      .populate('sharing.userId', 'name email avatar')
      .populate('lastModifiedBy', 'name email avatar');

    if (!whiteboard) {
      return NextResponse.json({ error: 'Whiteboard not found' }, { status: 404 });
    }

    // Get owner ID (handle both populated and non-populated cases)
    const ownerId = whiteboard.owner?._id?.toString() || whiteboard.owner?.toString();
    const userId = user.id?.toString();

    // Check if user is owner
    const isOwner = ownerId === userId;

    // Check if user has sharing access
    const shareEntry = whiteboard.sharing?.find(s => {
      const shareUserId = s.userId?._id?.toString() || s.userId?.toString();
      return shareUserId === userId;
    });

    // For now, allow all authenticated users to view boards (for team collaboration)
    // Determine permission level
    let permission = 'view_only';
    if (isOwner) {
      permission = 'owner';
    } else if (shareEntry) {
      permission = shareEntry.permission;
    }
    // All authenticated users can at least view boards in the organization

    return NextResponse.json({
      whiteboard: whiteboard.toObject(),
      permission
    });
  } catch (error) {
    console.error('Error fetching whiteboard:', error);
    return NextResponse.json({ error: 'Failed to fetch whiteboard' }, { status: 500 });
  }
}

// PUT /api/whiteboard/[id] - Update whiteboard
export async function PUT(request, { params }) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    await connectDB();

    const whiteboard = await Whiteboard.findById(id);
    if (!whiteboard) {
      return NextResponse.json({ error: 'Whiteboard not found' }, { status: 404 });
    }

    // Get owner ID (handle both populated and non-populated cases)
    const ownerId = whiteboard.owner?._id?.toString() || whiteboard.owner?.toString();
    const userId = user.id?.toString();

    // Check if user is owner or has editor permission
    const isOwner = ownerId === userId;
    const shareEntry = whiteboard.sharing?.find(s => {
      const shareUserId = s.userId?._id?.toString() || s.userId?.toString();
      return shareUserId === userId;
    });
    const isEditor = shareEntry?.permission === 'editor';

    // Allow owner and editors to update
    if (!isOwner && !isEditor) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const body = await request.json();
    const { title, description, pages, theme, showGrid, currentPageIndex, thumbnail, tags, aiAnalysis } = body;

    // Update fields if provided
    if (title !== undefined) whiteboard.title = title;
    if (description !== undefined) whiteboard.description = description;
    if (pages !== undefined) whiteboard.pages = pages;
    if (theme !== undefined) whiteboard.theme = theme;
    if (showGrid !== undefined) whiteboard.showGrid = showGrid;
    if (currentPageIndex !== undefined) whiteboard.currentPageIndex = currentPageIndex;
    if (tags !== undefined) whiteboard.tags = tags;
    if (aiAnalysis !== undefined) whiteboard.aiAnalysis = aiAnalysis;

    // Handle thumbnail - upload to ImageKit if it's base64
    if (thumbnail !== undefined) {
      if (thumbnail && thumbnail.startsWith('data:image/') && isImageKitConfigured()) {
        try {
          // Delete old thumbnail from ImageKit if exists
          if (whiteboard.thumbnailFileId) {
            await deleteFromImageKit(whiteboard.thumbnailFileId).catch(() => { });
          }

          // Get folder path with whiteboard ID
          const imagekitFolder = getImageKitFolder('whiteboard', { whiteboardId: id });

          // Upload new thumbnail to ImageKit
          const imagekitResult = await uploadImageToImageKit(thumbnail, {
            fileName: `whiteboard_${id}_thumb_${Date.now()}.webp`,
            folder: imagekitFolder,
            tags: ['whiteboard', 'thumbnail'],
            customMetadata: {
              whiteboardId: id,
              userId: user.id,
            },
          });

          whiteboard.thumbnail = imagekitResult.url;
          whiteboard.thumbnailFileId = imagekitResult.fileId;
          console.log(`[Whiteboard] Thumbnail uploaded to ImageKit: ${imagekitFolder}`);
        } catch (imgError) {
          console.error('[Whiteboard] ImageKit thumbnail upload failed:', imgError.message);
          // Fallback to storing base64 (not recommended but backwards compatible)
          whiteboard.thumbnail = thumbnail;
        }
      } else {
        whiteboard.thumbnail = thumbnail;
      }
    }

    whiteboard.lastModifiedBy = user.id;
    whiteboard.lastModified = new Date();

    await whiteboard.save();

    // Emit socket event for realtime collaboration
    if (global.io) {
      global.io.to(`whiteboard:${id}`).emit('whiteboard:updated', {
        whiteboardId: id,
        updatedBy: user.id,
        timestamp: Date.now()
      });
    }

    return NextResponse.json({
      success: true,
      whiteboard: {
        _id: whiteboard._id,
        title: whiteboard.title,
        lastModified: whiteboard.lastModified
      }
    });
  } catch (error) {
    console.error('Error updating whiteboard:', error);
    return NextResponse.json({ error: 'Failed to update whiteboard' }, { status: 500 });
  }
}

// DELETE /api/whiteboard/[id] - Delete whiteboard
export async function DELETE(request, { params }) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    await connectDB();

    const whiteboard = await Whiteboard.findById(id);
    if (!whiteboard) {
      return NextResponse.json({ error: 'Whiteboard not found' }, { status: 404 });
    }

    // Only owner can delete
    if (whiteboard.owner.toString() !== user.id) {
      return NextResponse.json({ error: 'Only the owner can delete this whiteboard' }, { status: 403 });
    }

    await Whiteboard.findByIdAndDelete(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting whiteboard:', error);
    return NextResponse.json({ error: 'Failed to delete whiteboard' }, { status: 500 });
  }
}
