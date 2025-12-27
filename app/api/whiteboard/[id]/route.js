import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth'
import { uploadImageToImageKit, deleteFromImageKit, getImageKitFolder } from '@/lib/imagekit';

// Check if ImageKit is configured
const isImageKitConfigured = () => {
  return !!(
    process.env.IMAGEKIT_PUBLIC_KEY &&
    process.env.IMAGEKIT_PRIVATE_KEY &&
    process.env.IMAGEKIT_URL_ENDPOINT
  )
}

// GET /api/whiteboard/[id] - Get single whiteboard
export async function GET(request, { params }) {
  try {
    const { id } = await params;

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Whiteboard', 'User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Whiteboard, User, Employee } = models

    // Get employee ID from user
    const userRecord = await User.findById(user._id || user.userId).select('employeeId').lean()
    let employeeId = userRecord?.employeeId
    
    if (!employeeId) {
      const employee = await Employee.findOne({ userId: user._id || user.userId }).select('_id').lean()
      employeeId = employee?._id
    }

    const whiteboard = await Whiteboard.findById(id)
      .populate('createdBy', 'firstName lastName email profilePicture')
      .populate('sharedWith', 'firstName lastName email profilePicture');

    if (!whiteboard) {
      return NextResponse.json({ error: 'Whiteboard not found' }, { status: 404 });
    }

    // Get creator ID (handle both populated and non-populated cases)
    const creatorId = whiteboard.createdBy?._id?.toString() || whiteboard.createdBy?.toString();
    const empId = employeeId?.toString();

    // Check if user is owner
    const isOwner = creatorId === empId;

    // Check if user has sharing access
    const isShared = whiteboard.sharedWith?.some(s => {
      const sharedId = s._id?.toString() || s.toString();
      return sharedId === empId;
    });

    // Determine permission level
    let permission = 'view_only';
    if (isOwner) {
      permission = 'owner';
    } else if (isShared) {
      permission = 'editor';
    }

    // Return whiteboard with normalized fields for UI compatibility
    const whiteboardData = whiteboard.toObject();
    whiteboardData.title = whiteboardData.name;
    whiteboardData.owner = whiteboardData.createdBy;

    return NextResponse.json({
      whiteboard: whiteboardData,
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
    const { id } = await params;

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Whiteboard', 'User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ error: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Whiteboard, User, Employee } = models

    // Get employee ID from user
    const userRecord = await User.findById(user._id || user.userId).select('employeeId').lean()
    let employeeId = userRecord?.employeeId
    
    if (!employeeId) {
      const employee = await Employee.findOne({ userId: user._id || user.userId }).select('_id').lean()
      employeeId = employee?._id
    }

    const whiteboard = await Whiteboard.findById(id);
    if (!whiteboard) {
      return NextResponse.json({ error: 'Whiteboard not found' }, { status: 404 });
    }

    // Get creator ID (handle both populated and non-populated cases)
    const creatorId = whiteboard.createdBy?._id?.toString() || whiteboard.createdBy?.toString();
    const empId = employeeId?.toString();

    // Check if user is owner or has shared access
    const isOwner = creatorId === empId;
    const isShared = whiteboard.sharedWith?.some(s => {
      const sharedId = s._id?.toString() || s.toString();
      return sharedId === empId;
    });

    // Allow owner and shared users to update
    if (!isOwner && !isShared) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const body = await request.json();
    const { title, name, description, data, thumbnail, isPublic, sharedWith } = body;

    // Update fields if provided
    if (name !== undefined) whiteboard.name = name;
    if (title !== undefined) whiteboard.name = title; // Handle title for UI compatibility
    if (description !== undefined) whiteboard.description = description;
    if (data !== undefined) whiteboard.data = data;
    if (isPublic !== undefined) whiteboard.isPublic = isPublic;
    if (sharedWith !== undefined) whiteboard.sharedWith = sharedWith;
    
    // Handle thumbnail upload
    if (thumbnail !== undefined) {
      // Check if thumbnail is base64 and ImageKit is configured
      if (thumbnail && thumbnail.startsWith('data:') && isImageKitConfigured()) {
        try {
          const imagekitFolder = getImageKitFolder('whiteboards');
          const imagekitResult = await uploadImageToImageKit(thumbnail, `whiteboard-${id}-thumbnail`, {
            folder: imagekitFolder,
            tags: ['whiteboard', 'thumbnail'],
            customMetadata: {
              whiteboardId: id,
              userId: user._id || user.userId,
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

    whiteboard.lastModifiedBy = employeeId;
    whiteboard.lastModified = new Date();

    await whiteboard.save();

    // Emit socket event for realtime collaboration
    if (global.io) {
      global.io.to(`whiteboard:${id}`).emit('whiteboard:updated', {
        whiteboardId: id,
        updatedBy: user._id || user.userId,
        timestamp: Date.now()
      });
    }

    return NextResponse.json({
      success: true,
      whiteboard: {
        _id: whiteboard._id,
        title: whiteboard.name, // Return name as title for UI compatibility
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
    const { id } = await params;

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Whiteboard', 'User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ error: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Whiteboard, User, Employee } = models

    // Get employee ID from user
    const userRecord = await User.findById(user._id || user.userId).select('employeeId').lean()
    let employeeId = userRecord?.employeeId
    
    if (!employeeId) {
      const employee = await Employee.findOne({ userId: user._id || user.userId }).select('_id').lean()
      employeeId = employee?._id
    }

    const whiteboard = await Whiteboard.findById(id);
    if (!whiteboard) {
      return NextResponse.json({ error: 'Whiteboard not found' }, { status: 404 });
    }

    // Get creator ID (handle both populated and non-populated cases)
    const creatorId = whiteboard.createdBy?._id?.toString() || whiteboard.createdBy?.toString();
    const empId = employeeId?.toString();

    // Only owner can delete
    if (creatorId !== empId) {
      return NextResponse.json({ error: 'Only the owner can delete this whiteboard' }, { status: 403 });
    }

    // Delete thumbnail from ImageKit if exists
    if (whiteboard.thumbnailFileId && isImageKitConfigured()) {
      try {
        await deleteFromImageKit(whiteboard.thumbnailFileId);
      } catch (imgError) {
        console.error('[Whiteboard] Failed to delete thumbnail from ImageKit:', imgError.message);
      }
    }

    await Whiteboard.findByIdAndDelete(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting whiteboard:', error);
    return NextResponse.json({ error: 'Failed to delete whiteboard' }, { status: 500 });
  }
}
