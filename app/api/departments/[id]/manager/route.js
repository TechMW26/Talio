import { NextResponse } from 'next/server'
import { getAuthAndModels, hasRole } from '@/lib/auth'

/**
 * POST /api/departments/[id]/manager
 * Assign a Department Manager to a department.
 * Only admin, hr, or the department head can assign a manager.
 * Body: { employeeId } or { employeeIds: [...] } for multiple managers
 */
export async function POST(request, context) {
    try {
        const { id } = await context.params
        const auth = await getAuthAndModels(request, ['Department', 'Employee', 'User'])
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 })
        }
        const { user, models } = auth
        const { Department, User, Employee } = models

        // Only admin, hr, or department_head can assign managers
        if (!hasRole(user, ['admin', 'hr', 'department_head'])) {
            return NextResponse.json({ success: false, message: 'Only admin, HR, or department head can assign department managers' }, { status: 403 })
        }

        const dept = await Department.findById(id)
        if (!dept) {
            return NextResponse.json({ success: false, message: 'Department not found' }, { status: 404 })
        }

        const data = await request.json()
        const employeeIds = data.employeeIds || (data.employeeId ? [data.employeeId] : [])

        if (employeeIds.length === 0) {
            return NextResponse.json({ success: false, message: 'employeeId or employeeIds required' }, { status: 400 })
        }

        // Verify employees exist
        const employees = await Employee.find({ _id: { $in: employeeIds }, status: 'active' })
        if (employees.length !== employeeIds.length) {
            return NextResponse.json({ success: false, message: 'One or more employees not found or inactive' }, { status: 404 })
        }

        // A department head cannot be demoted to manager of the same department
        const headIds = new Set([
            ...(dept.heads || []).map(String),
            dept.head ? dept.head.toString() : null,
        ].filter(Boolean))
        const conflicts = employeeIds.filter(id => headIds.has(String(id)))
        if (conflicts.length > 0) {
            return NextResponse.json({
                success: false,
                message: 'Cannot assign a department head as a manager of the same department',
            }, { status: 400 })
        }

        // Update department — backward compatible (set legacy field + array)
        dept.departmentManager = employeeIds[0]
        dept.departmentManagers = employeeIds
        await dept.save()

        // Update User documents
        await User.updateMany(
            { employeeId: { $in: employeeIds } },
            {
                $addToSet: { departmentManagerOf: id },
                $set: { isDepartmentManager: true },
            }
        )

        // If role was 'employee', upgrade to 'department_manager'
        await User.updateMany(
            { employeeId: { $in: employeeIds }, role: 'employee' },
            { $set: { role: 'department_manager' } }
        )

        const updated = await Department.findById(id)
            .populate('head', 'firstName lastName employeeCode')
            .populate('heads', 'firstName lastName employeeCode')
            .populate('departmentManager', 'firstName lastName employeeCode')
            .populate('departmentManagers', 'firstName lastName employeeCode')

        return NextResponse.json({
            success: true,
            data: updated,
            message: 'Department manager(s) assigned successfully',
        })
    } catch (error) {
        console.error('POST /api/departments/[id]/manager error:', error)
        return NextResponse.json({ success: false, message: 'Failed to assign department manager' }, { status: 500 })
    }
}

/**
 * DELETE /api/departments/[id]/manager
 * Remove a department manager
 * Body: { employeeId } or { employeeIds: [...] }
 */
export async function DELETE(request, context) {
    try {
        const { id } = await context.params
        const auth = await getAuthAndModels(request, ['Department', 'User'])
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 })
        }
        const { user, models } = auth
        const { Department, User } = models

        if (!hasRole(user, ['admin', 'hr', 'department_head'])) {
            return NextResponse.json({ success: false, message: 'Only admin, HR, or department head can remove department managers' }, { status: 403 })
        }

        const data = await request.json()
        const employeeIds = data.employeeIds || (data.employeeId ? [data.employeeId] : [])

        if (employeeIds.length === 0) {
            return NextResponse.json({ success: false, message: 'employeeId or employeeIds required' }, { status: 400 })
        }

        // Remove from department
        await Department.findByIdAndUpdate(id, {
            $pull: { departmentManagers: { $in: employeeIds } },
        })

        // If the legacy field matches any removed manager, clear it
        const dept = await Department.findById(id)
        if (dept.departmentManager && employeeIds.map(String).includes(dept.departmentManager.toString())) {
            dept.departmentManager = dept.departmentManagers?.[0] || null
            await dept.save()
        }

        // Update User documents
        await User.updateMany(
            { employeeId: { $in: employeeIds } },
            { $pull: { departmentManagerOf: id } }
        )

        // If user no longer manages any departments, clear the flag and role
        for (const empId of employeeIds) {
            const u = await User.findOne({ employeeId: empId })
            if (u && (!u.departmentManagerOf || u.departmentManagerOf.length === 0)) {
                u.isDepartmentManager = false
                // Only downgrade role if they were specifically department_manager
                if (u.role === 'department_manager') {
                    u.role = 'employee'
                }
                await u.save()
            }
        }

        return NextResponse.json({ success: true, message: 'Department manager(s) removed successfully' })
    } catch (error) {
        console.error('DELETE /api/departments/[id]/manager error:', error)
        return NextResponse.json({ success: false, message: 'Failed to remove department manager' }, { status: 500 })
    }
}
