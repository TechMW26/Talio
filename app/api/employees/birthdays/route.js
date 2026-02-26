import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import queryCache from '@/lib/queryCache'

export const dynamic = 'force-dynamic'

// GET - Lightweight endpoint for calendar birthdays
// Only returns name, employeeCode, dateOfBirth for employees with a DOB set
export async function GET(request) {
    try {
        const auth = await getAuthAndModels(request, ['Employee'])
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 })
        }

        const { models: { Employee: TenantEmployee } } = auth

        // Check cache
        const cacheKey = queryCache.generateKey('employee-birthdays-list')
        const cached = queryCache.get(cacheKey)
        if (cached) {
            return NextResponse.json(cached)
        }

        // Only fetch employees who have a dateOfBirth, and only the fields we need
        const birthdays = await TenantEmployee.find({
            status: 'active',
            dateOfBirth: { $exists: true, $ne: null }
        })
            .select('firstName lastName employeeCode dateOfBirth _id')
            .sort({ firstName: 1 })
            .lean()

        const response = {
            success: true,
            data: birthdays
        }

        // Cache for 5 minutes (birthdays don't change often)
        queryCache.set(cacheKey, response, 300000)

        return NextResponse.json(response)
    } catch (error) {
        console.error('Get birthdays error:', error)
        return NextResponse.json(
            { success: false, message: 'Failed to fetch birthdays', error: error.message },
            { status: 500 }
        )
    }
}
