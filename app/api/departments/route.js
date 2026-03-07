import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { updateDepartmentHeadsForDepartment } from '@/lib/departmentHeadSync'
import { emitDepartmentUpdate } from '@/lib/realtimeEvents'
import { buildCacheKey, buildCachePattern, getCache, setCache, clearCachePattern } from '@/lib/cache'

// GET - List all departments
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Department', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models, tenant } = auth
    const { Department, Employee } = models

    // Check Redis cache first (departments rarely change — 5 min TTL)
    const cacheKey = buildCacheKey({
      tenantId: tenant?.databaseName,
      role: 'any',
      userId: 'all',
      namespace: 'departments:list',
    })
    const cached = await getCache(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    // Single aggregation to fetch departments with employee counts (avoids N+1 queries)
    const departmentsWithCount = await Department.aggregate([
      { $match: { isActive: true } },
      { $sort: { name: 1 } },
      // Lookup head (single)
      {
        $lookup: {
          from: 'employees',
          localField: 'head',
          foreignField: '_id',
          as: 'head',
          pipeline: [
            { $project: { firstName: 1, lastName: 1, employeeCode: 1, email: 1, designation: 1 } }
          ]
        }
      },
      { $unwind: { path: '$head', preserveNullAndEmptyArrays: true } },
      // Lookup heads (array)
      {
        $lookup: {
          from: 'employees',
          localField: 'heads',
          foreignField: '_id',
          as: 'heads',
          pipeline: [
            { $project: { firstName: 1, lastName: 1, employeeCode: 1, email: 1, designation: 1 } }
          ]
        }
      },
      // Count employees belonging to this department (via departments array or legacy department field)
      {
        $lookup: {
          from: 'employees',
          let: { deptId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$status', 'active'] },
                    {
                      $or: [
                        { $in: ['$$deptId', { $ifNull: ['$departments', []] }] },
                        { $eq: ['$department', '$$deptId'] }
                      ]
                    }
                  ]
                }
              }
            },
            { $count: 'count' }
          ],
          as: 'employeeStats'
        }
      },
      {
        $addFields: {
          employeeCount: {
            $ifNull: [{ $arrayElemAt: ['$employeeStats.count', 0] }, 0]
          }
        }
      },
      // Lookup department managers
      {
        $lookup: {
          from: 'employees',
          localField: 'departmentManagers',
          foreignField: '_id',
          as: 'departmentManagers',
          pipeline: [
            { $project: { firstName: 1, lastName: 1, employeeCode: 1, email: 1, designation: 1 } }
          ]
        }
      },
      // Lookup teams belonging to this department (by team.department reference)
      {
        $lookup: {
          from: 'teams',
          let: { deptId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$department', '$$deptId'] }, isActive: true } },
            { $sort: { teamName: 1 } },
            { $project: { teamName: 1, teamCode: 1, description: 1, teamLeaders: 1, members: 1 } }
          ],
          as: 'teams'
        }
      },
      { $project: { employeeStats: 0 } }
    ])

    const responseData = { success: true, data: departmentsWithCount }
    // Cache for 5 minutes
    await setCache(cacheKey, responseData, 300)

    return NextResponse.json(responseData)
  } catch (error) {
    console.error('Get departments error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch departments' },
      { status: 500 }
    )
  }
}

// POST - Create new department
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Department', 'User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models } = auth
    const { Department, User, Employee } = models

    const data = await request.json()

    // Handle multiple heads - ensure backwards compatibility
    if (data.heads && data.heads.length > 0) {
      // Set the first head as the legacy 'head' field for backwards compatibility
      data.head = data.heads[0]
    } else if (data.head && !data.heads) {
      // If only single head provided, also add to heads array
      data.heads = [data.head]
    }

    const department = await Department.create(data)

    // Sync department head status to User meta (fire and forget)
    if (data.heads && data.heads.length > 0) {
      updateDepartmentHeadsForDepartment(department._id.toString(), [], data.heads, { User, Employee, Department })
        .catch(err => console.error('Error syncing department heads:', err));
    }

    // Bust departments cache for this tenant
    const bustPattern = buildCachePattern({ tenantId: auth.tenant?.databaseName, namespace: 'departments:list' })
    await clearCachePattern(bustPattern).catch(() => { })

    // Emit real-time event for department updates
    emitDepartmentUpdate(department.toObject ? department.toObject() : department, { action: 'create' })

    return NextResponse.json({
      success: true,
      message: 'Department created successfully',
      data: department,
    }, { status: 201 })
  } catch (error) {
    console.error('Create department error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to create department' },
      { status: 500 }
    )
  }
}

