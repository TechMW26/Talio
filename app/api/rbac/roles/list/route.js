import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

// GET /api/rbac/roles/list — lightweight role list for dropdowns (auth-only, no admin permission required)
export async function GET(request) {
    try {
        const auth = await getAuthAndModels(request, ['Role'])
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 })
        }
        const { models } = auth

        const roles = await models.Role.find({ company: { $exists: true } })
            .select('_id name displayLabel isSystemRole description')
            .sort({ isSystemRole: -1, name: 1 })
            .lean()

        return NextResponse.json({ success: true, data: roles })
    } catch (error) {
        console.error('[RBAC] List roles (light) error:', error)
        return NextResponse.json(
            { success: false, message: 'Failed to fetch roles' },
            { status: 500 }
        )
    }
}
