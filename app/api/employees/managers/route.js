import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import queryCache from '@/lib/queryCache'

export const dynamic = 'force-dynamic'

// GET - Lightweight endpoint for manager dropdown (Bulk Edit)
// Only returns name + employeeCode for employees with level >= 4
export async function GET(request) {
    try {
        const auth = await getAuthAndModels(request, ['Employee'])
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 })
        }

        const { models: { Employee: TenantEmployee } } = auth

        // Check cache
        const cacheKey = queryCache.generateKey('employee-managers-list')
        const cached = queryCache.get(cacheKey)
        if (cached) {
            return NextResponse.json(cached)
        }

        // Server-side filter: only active employees with level >= 4
        const managers = await TenantEmployee.find({
            status: 'active',
            designationLevel: { $gte: 4 }
        })
            .select('firstName lastName employeeCode _id')
            .sort({ firstName: 1 })
            .lean()

        const response = {
            success: true,
            data: managers
        }

        // Cache for 2 minutes (managers don't change often)
        queryCache.set(cacheKey, response, 120000)

        return NextResponse.json(response)
    } catch (error) {
        console.error('Get managers error:', error)
        return NextResponse.json(
            { success: false, message: 'Failed to fetch managers', error: error.message },
            { status: 500 }
        )
    }
}
