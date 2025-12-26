import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth'
import { jwtVerify } from 'jose';

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
    const auth = await getAuthAndModels(request, ['Whiteboard', 'User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models } = auth
    const { Whiteboard, User, Employee } = models

    // Get employee ID from user
    const userRecord = await User.findById(user.id).select('employeeId').lean()
    let employeeId = userRecord?.employeeId
    
    if (!employeeId) {
      const employee = await Employee.findOne({ userId: user.id }).select('_id').lean()
      employeeId = employee?._id
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const skip = (page - 1) * limit;

    // Build query - get boards created by user OR shared with user
    const query = {
      $or: [
        { createdBy: employeeId },
        { sharedWith: employeeId }
      ]
    };

    // Add search filter
    if (search) {
      query.$and = [
        { $or: query.$or },
        { $or: [
          { name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } }
        ]}
      ];
      delete query.$or;
    }

    const [boards, total] = await Promise.all([
      Whiteboard.find(query)
        .select('name description thumbnail createdBy sharedWith isPublic createdAt updatedAt')
        .populate('createdBy', 'firstName lastName email profilePicture')
        .populate('sharedWith', 'firstName lastName email profilePicture')
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Whiteboard.countDocuments(query)
    ]);

    // Add permission info for each board
    const boardsWithPermissions = boards.map(board => {
      const isOwner = board.createdBy?._id?.toString() === employeeId?.toString();
      const isShared = board.sharedWith?.some(s => s._id?.toString() === employeeId?.toString());
      
      return { 
        ...board, 
        // Normalize fields for UI compatibility
        title: board.name,
        owner: board.createdBy,
        userPermission: isOwner ? 'owner' : (isShared ? 'editor' : 'view_only'),
        isOwner: isOwner
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

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Whiteboard', 'User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ error: auth.message }, { status: 401 })
    }
    const { models } = auth
    const { Whiteboard, User, Employee } = models

    // Get employee ID from user
    const userRecord = await User.findById(user.id).select('employeeId').lean()
    let employeeId = userRecord?.employeeId
    
    if (!employeeId) {
      const employee = await Employee.findOne({ userId: user.id }).select('_id').lean()
      employeeId = employee?._id
    }

    if (!employeeId) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
    }

    const body = await request.json();
    const { title, name, description } = body;

    const whiteboard = new Whiteboard({
      name: name || title || 'Untitled Board',
      description: description || '',
      createdBy: employeeId,
      data: null,
      isPublic: false,
      sharedWith: []
    });

    await whiteboard.save();

    return NextResponse.json({
      success: true,
      whiteboard: {
        _id: whiteboard._id,
        name: whiteboard.name,
        title: whiteboard.name, // For UI compatibility
        description: whiteboard.description,
        createdAt: whiteboard.createdAt
      }
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating whiteboard:', error.message, error.stack);
    return NextResponse.json({ error: 'Failed to create whiteboard', details: error.message }, { status: 500 });
  }
}
