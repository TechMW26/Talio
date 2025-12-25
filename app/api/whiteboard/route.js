import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth'
import { jwtVerify } from 'jose';
;
;

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'your-secret-key');

async function verifyAuth(request) {
  try {
    const token = request.cookies.get('token')?.value || 
                  request.headers.get('authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return null;
    }

    const { payload } = await jwtVerify(token, JWT_SECRET);
    // Return normalized user object with id field
    return {
      id: payload.userId || payload.id,
      ...payload
    };
  } catch (error) {
    console.error('Auth verification failed:', error);
    return null;
  }
}

// GET /api/whiteboard - List all whiteboards for user
export async function GET(request) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Whiteboard'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Whiteboard } = models

    ;

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const folder = searchParams.get('folder');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const skip = (page - 1) * limit;

    // Build query - get boards owned by user OR shared with user
    const query = {
      $or: [
        { owner: user.id },
        { 'sharing.userId': user.id }
      ]
    };

    // Add search filter
    if (search) {
      query.$and = [
        { $or: query.$or },
        { $or: [
          { title: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
          { tags: { $in: [new RegExp(search, 'i')] } }
        ]}
      ];
      delete query.$or;
    }

    // Add folder filter
    if (folder === 'null' || folder === 'root') {
      query.folderId = null;
    } else if (folder) {
      query.folderId = folder;
    }

    const [boards, total] = await Promise.all([
      Whiteboard.find(query)
        .select('title description thumbnail owner sharing theme lastModified createdAt tags')
        .populate('owner', 'name email avatar')
        .sort({ lastModified: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Whiteboard.countDocuments(query)
    ]);

    // Add permission info for each board
    const boardsWithPermissions = boards.map(board => {
      let permission = 'view_only';
      const isOwner = board.owner._id.toString() === user.id;
      if (isOwner) {
        permission = 'owner';
      } else {
        const share = board.sharing?.find(s => s.userId.toString() === user.id);
        if (share) {
          permission = share.permission;
        }
      }
      return { 
        ...board, 
        // Normalize fields - use 'name' for UI compatibility
        name: board.title,
        userPermission: permission,
        isOwner: isOwner,
        sharedWith: board.sharing || []
      };
    });

    return NextResponse.json({
      boards: boardsWithPermissions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching whiteboards:', error);
    return NextResponse.json({ error: 'Failed to fetch whiteboards' }, { status: 500 });
  }
}

// POST /api/whiteboard - Create new whiteboard
export async function POST(request) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    ;

    const body = await request.json();
    const { title, description, theme, folderId } = body;

    const whiteboard = new Whiteboard({
      title: title || 'Untitled Board',
      description: description || '',
      owner: user.id,
      theme: theme || 'white',
      folderId: folderId || null,
      pages: [{
        id: `page-${Date.now()}`,
        objects: [],
        thumbnail: null
      }]
    });

    await whiteboard.save();

    return NextResponse.json({
      success: true,
      whiteboard: {
        _id: whiteboard._id,
        title: whiteboard.title,
        description: whiteboard.description,
        theme: whiteboard.theme,
        createdAt: whiteboard.createdAt
      }
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating whiteboard:', error.message, error.stack);
    return NextResponse.json({ error: 'Failed to create whiteboard', details: error.message }, { status: 500 });
  }
}
