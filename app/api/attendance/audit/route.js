import { NextResponse } from 'next/server'
import { verifyTokenFromRequest, getAuthAndModels } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/attendance/audit
 * 
 * Get audit information about attendance records, specifically system-generated absences.
 * This endpoint is useful for admins to review auto-marked absent records.
 * 
 * Query params:
 *   - date: Specific date (YYYY-MM-DD)
 *   - startDate, endDate: Date range
 *   - source: Filter by source (system_auto_absent, system_backfill, user_checkin, etc.)
 *   - onlySystemGenerated: Only show system-generated records (true/false)
 *   - employeeId: Filter by specific employee
 *   - page: Page number (default: 1)
 *   - limit: Records per page (default: 50)
 */
export async function GET(request) {
    try {
        // Verify admin/HR access
        const authResult = await verifyTokenFromRequest(request)
        if (!authResult.success) {
            return NextResponse.json(
                { success: false, message: authResult.message },
                { status: 401 }
            )
        }

        if (!['admin', 'hr', 'manager'].includes(authResult.user.role)) {
            return NextResponse.json(
                { success: false, message: 'Admin, HR, or Manager access required' },
                { status: 403 }
            )
        }

        // TODO: MIGRATION - Replace verifyTokenFromRequest with getAuthAndModels
    // const { success, user, models, message } = await getAuthAndModels(request, ['Attendance', 'Employee'])
    // if (!success) return NextResponse.json({ message }, { status: 401 })
    // const { Attendance, Employee } = models
    const { searchParams } = new URL(request.url)
        const date = searchParams.get('date')
        const startDate = searchParams.get('startDate')
        const endDate = searchParams.get('endDate')
        const source = searchParams.get('source')
        const onlySystemGenerated = searchParams.get('onlySystemGenerated') === 'true'
        const employeeId = searchParams.get('employeeId')
        const page = parseInt(searchParams.get('page')) || 1
        const limit = Math.min(parseInt(searchParams.get('limit')) || 50, 200)

        // Build query
        const query = {}

        // Date filters
        if (date) {
            const dayStart = new Date(date)
            dayStart.setHours(0, 0, 0, 0)
            const dayEnd = new Date(dayStart)
            dayEnd.setDate(dayEnd.getDate() + 1)
            query.date = { $gte: dayStart, $lt: dayEnd }
        } else if (startDate || endDate) {
            query.date = {}
            if (startDate) {
                const start = new Date(startDate)
                start.setHours(0, 0, 0, 0)
                query.date.$gte = start
            }
            if (endDate) {
                const end = new Date(endDate)
                end.setHours(23, 59, 59, 999)
                query.date.$lte = end
            }
        }

        // Source filter
        if (source) {
            query.source = source
        }

        // System generated filter
        if (onlySystemGenerated) {
            query.$or = [
                { createdBySystem: true },
                { source: { $in: ['system_auto_absent', 'system_backfill'] } }
            ]
        }

        // Employee filter
        if (employeeId) {
            query.employee = employeeId
        }

        // Get total count
        const totalCount = await Attendance.countDocuments(query)

        // Get records with pagination
        const records = await Attendance.find(query)
            .populate({
                path: 'employee',
                select: 'firstName lastName email employeeCode'
            })
            .populate({
                path: 'createdBy',
                select: 'email'
            })
            .populate({
                path: 'lastModifiedBy',
                select: 'email'
            })
            .sort({ date: -1, createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean()

        // Get summary stats
        const stats = await Attendance.aggregate([
            { $match: query },
            {
                $group: {
                    _id: '$source',
                    count: { $sum: 1 }
                }
            }
        ])

        const sourceBreakdown = stats.reduce((acc, curr) => {
            acc[curr._id || 'unknown'] = curr.count
            return acc
        }, {})

        // Format records for response
        const formattedRecords = records.map(record => ({
            _id: record._id,
            date: record.date,
            employee: record.employee ? {
                _id: record.employee._id,
                name: `${record.employee.firstName} ${record.employee.lastName}`,
                email: record.employee.email,
                employeeCode: record.employee.employeeCode
            } : null,
            status: record.status,
            checkIn: record.checkIn,
            checkOut: record.checkOut,
            workHours: record.workHours,
            statusReason: record.statusReason,
            remarks: record.remarks,
            // Audit fields
            source: record.source || 'user_checkin',
            isSystemGenerated: record.createdBySystem ||
                ['system_auto_absent', 'system_backfill'].includes(record.source),
            isManualEntry: record.isManualEntry,
            createdBy: record.createdBy?.email,
            lastModifiedBy: record.lastModifiedBy?.email,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt
        }))

        return NextResponse.json({
            success: true,
            data: {
                records: formattedRecords,
                pagination: {
                    page,
                    limit,
                    total: totalCount,
                    totalPages: Math.ceil(totalCount / limit)
                },
                summary: {
                    total: totalCount,
                    bySource: sourceBreakdown
                }
            }
        })

    } catch (error) {
        console.error('Attendance audit API error:', error)
        return NextResponse.json(
            { success: false, message: error.message },
            { status: 500 }
        )
    }
}
