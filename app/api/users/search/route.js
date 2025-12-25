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

// GET /api/users/search - Search for users
export async function GET(request) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models } = auth
    const { User, Employee } = models

    ;

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';
    const limit = parseInt(searchParams.get('limit') || '10');

    // Build aggregation pipeline to search users and their linked employee data
    const pipeline = [
      // Exclude current user
      { $match: { _id: { $ne: new (await import('mongoose')).default.Types.ObjectId(user.id) } } },
      // Lookup employee data
      {
        $lookup: {
          from: 'employees',
          localField: 'employeeId',
          foreignField: '_id',
          as: 'employee'
        }
      },
      // Unwind employee (will be null if no employee linked)
      {
        $unwind: {
          path: '$employee',
          preserveNullAndEmptyArrays: true
        }
      },
      // Add computed name field
      {
        $addFields: {
          name: {
            $cond: {
              if: { $and: ['$employee.firstName', '$employee.lastName'] },
              then: { $concat: ['$employee.firstName', ' ', '$employee.lastName'] },
              else: {
                $cond: {
                  if: '$employee.firstName',
                  then: '$employee.firstName',
                  else: { $ifNull: ['$email', 'Unknown User'] }
                }
              }
            }
          },
          avatar: { $ifNull: ['$employee.avatar', null] }
        }
      }
    ];

    // Add search filter if query provided
    if (query) {
      pipeline.push({
        $match: {
          $or: [
            { 'employee.firstName': { $regex: query, $options: 'i' } },
            { 'employee.lastName': { $regex: query, $options: 'i' } },
            { email: { $regex: query, $options: 'i' } },
            { name: { $regex: query, $options: 'i' } }
          ]
        }
      });
    }

    // Project only needed fields
    pipeline.push({
      $project: {
        _id: 1,
        name: 1,
        email: 1,
        avatar: 1,
        role: 1
      }
    });

    // Limit results
    pipeline.push({ $limit: limit });

    const users = await User.aggregate(pipeline);

    return NextResponse.json({
      users,
      count: users.length
    });
  } catch (error) {
    console.error('Error searching users:', error);
    return NextResponse.json({ error: 'Failed to search users' }, { status: 500 });
  }
}
