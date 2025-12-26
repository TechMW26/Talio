import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth'
import { jwtVerify } from 'jose';

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

    const whiteboard = await Whiteboard.findById(id)
      .select('createdBy sharedWith isPublic')
      .populate('createdBy', 'firstName lastName email profilePicture')
      .populate('sharedWith', 'firstName lastName email profilePicture');

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

    // Only owner or shared users can see sharing info
    if (!isOwner && !isShared) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    return NextResponse.json({
      sharedWith: whiteboard.sharedWith,
      isPublic: whiteboard.isPublic,
      isOwner
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

    const whiteboard = await Whiteboard.findById(id);
    if (!whiteboard) {
      return NextResponse.json({ error: 'Whiteboard not found' }, { status: 404 });
    }

    // Get creator ID (handle both populated and non-populated cases)
    const creatorId = whiteboard.createdBy?._id?.toString() || whiteboard.createdBy?.toString();
    const empId = employeeId?.toString();

    // Only owner can share
    if (creatorId !== empId) {
      return NextResponse.json({ error: 'Only the owner can share this whiteboard' }, { status: 403 });
    }

    const body = await request.json();
    const { email, employeeIds, isPublic } = body;

    // Handle public sharing
    if (isPublic !== undefined) {
      whiteboard.isPublic = isPublic;
    }

    // Handle user sharing by email
    if (email) {
      const targetUser = await User.findOne({ email: email.toLowerCase() }).select('employeeId');
      if (!targetUser) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      let targetEmployeeId = targetUser.employeeId;
      if (!targetEmployeeId) {
        const targetEmployee = await Employee.findOne({ userId: targetUser._id }).select('_id');
        targetEmployeeId = targetEmployee?._id;
      }

      if (!targetEmployeeId) {
        return NextResponse.json({ error: 'Employee record not found for user' }, { status: 404 });
      }

      // Can't share with yourself
      if (targetEmployeeId.toString() === empId) {
        return NextResponse.json({ error: 'Cannot share with yourself' }, { status: 400 });
      }

      // Add to sharedWith if not already present
      const alreadyShared = whiteboard.sharedWith?.some(
        s => s.toString() === targetEmployeeId.toString()
      );

      if (!alreadyShared) {
        whiteboard.sharedWith = whiteboard.sharedWith || [];
        whiteboard.sharedWith.push(targetEmployeeId);
      }
    }

    // Handle bulk sharing by employee IDs
    if (employeeIds && Array.isArray(employeeIds)) {
      whiteboard.sharedWith = whiteboard.sharedWith || [];
      for (const targetEmpId of employeeIds) {
        // Don't share with self
        if (targetEmpId.toString() === empId) continue;
        
        // Add if not already present
        const alreadyShared = whiteboard.sharedWith.some(
          s => s.toString() === targetEmpId.toString()
        );
        if (!alreadyShared) {
          whiteboard.sharedWith.push(targetEmpId);
        }
      }
    }

    await whiteboard.save();

    // Fetch updated sharing info
    const updatedWhiteboard = await Whiteboard.findById(id)
      .select('sharedWith isPublic')
      .populate('sharedWith', 'firstName lastName email profilePicture');

    return NextResponse.json({
      success: true,
      sharedWith: updatedWhiteboard.sharedWith,
      isPublic: updatedWhiteboard.isPublic
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
    const employeeIdToRemove = searchParams.get('employeeId');

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

    const whiteboard = await Whiteboard.findById(id);
    if (!whiteboard) {
      return NextResponse.json({ error: 'Whiteboard not found' }, { status: 404 });
    }

    // Get creator ID (handle both populated and non-populated cases)
    const creatorId = whiteboard.createdBy?._id?.toString() || whiteboard.createdBy?.toString();
    const empId = employeeId?.toString();

    // Only owner can remove shares
    if (creatorId !== empId) {
      return NextResponse.json({ error: 'Only the owner can modify sharing' }, { status: 403 });
    }

    if (employeeIdToRemove) {
      whiteboard.sharedWith = (whiteboard.sharedWith || []).filter(
        s => s.toString() !== employeeIdToRemove
      );
      await whiteboard.save();
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error removing share:', error);
    return NextResponse.json({ error: 'Failed to remove share' }, { status: 500 });
  }
}
