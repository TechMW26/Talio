import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import Attendance from '@/models/Attendance'
import Employee from '@/models/Employee'
import Leave from '@/models/Leave'
import Holiday from '@/models/Holiday'
import CompanySettings from '@/models/CompanySettings'
import Company from '@/models/Company'
import { sendPushToUser } from '@/lib/pushNotification'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Allow up to 60 seconds for processing

// Map day index (0-6) to day name
const DAY_INDEX_TO_NAME = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/**
 * Check if a date is a working day based on company settings
 */
function isWorkingDay(date, workingDays) {
    if (!workingDays || workingDays.length === 0) {
        const dayIndex = date.getDay()
        return dayIndex >= 1 && dayIndex <= 5
    }
    const dayName = DAY_INDEX_TO_NAME[date.getDay()]
    return workingDays.includes(dayName)
}

/**
 * Check if a date is a holiday
 */
function isHoliday(date, holidays) {
    const dateStart = new Date(date)
    dateStart.setHours(0, 0, 0, 0)

    for (const holiday of holidays) {
        if (!holiday.isActive) continue

        const holidayStart = new Date(holiday.date)
        holidayStart.setHours(0, 0, 0, 0)

        const holidayEnd = holiday.endDate ? new Date(holiday.endDate) : new Date(holiday.date)
        holidayEnd.setHours(23, 59, 59, 999)

        if (dateStart >= holidayStart && dateStart <= holidayEnd) {
            return holiday
        }
    }
    return null
}

/**
 * GET /api/cron/mark-absent
 * 
 * Daily cron job to mark employees as absent who didn't check in on the previous working day.
 * This should be scheduled to run daily (preferably early morning, e.g., 12:30 AM IST).
 * 
 * The job will:
 * 1. Process yesterday's date (or previous working day)
 * 2. Skip weekends and holidays
 * 3. Skip employees who are on approved leave
 * 4. Skip employees who haven't joined yet
 * 5. Create absent attendance records with audit trail
 * 6. Send push notifications to affected employees
 * 
 * Security: Protected by CRON_SECRET
 */
export async function GET(request) {
    const startTime = Date.now()

    try {
        // Verify cron secret
        const authHeader = request.headers.get('authorization')
        const cronSecret = process.env.CRON_SECRET

        if (!cronSecret) {
            console.error('[Cron MarkAbsent] CRON_SECRET not configured')
            return NextResponse.json(
                { success: false, message: 'Cron secret not configured' },
                { status: 500 }
            )
        }

        if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
            console.error('[Cron MarkAbsent] Unauthorized access attempt')
            return NextResponse.json(
                { success: false, message: 'Unauthorized' },
                { status: 401 }
            )
        }

        await connectDB()

        const now = new Date()
        console.log(`[Cron MarkAbsent] Starting at ${now.toISOString()}`)

        // Get working days from database - prioritize Company model (companies collection)
        // Based on the actual database structure where workingHours.workingDays is stored in Company
        let workingDays = null

        // First check Company model (this is where the data is actually stored)
        const company = await Company.findOne().lean()
        if (company?.workingHours?.workingDays && company.workingHours.workingDays.length > 0) {
            workingDays = company.workingHours.workingDays
            console.log('[Cron MarkAbsent] Using workingDays from Company.workingHours:', workingDays)
        }

        // Fallback to CompanySettings if Company doesn't have workingDays
        if (!workingDays || workingDays.length === 0) {
            const companySettings = await CompanySettings.findOne().lean()
            if (companySettings?.workingDays && companySettings.workingDays.length > 0) {
                workingDays = companySettings.workingDays
                console.log('[Cron MarkAbsent] Using workingDays from CompanySettings:', workingDays)
            }
        }

        // Final fallback to default Monday-Friday
        if (!workingDays || workingDays.length === 0) {
            workingDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
            console.log('[Cron MarkAbsent] Using default workingDays (Mon-Fri)')
        }

        // Process yesterday
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        yesterday.setHours(0, 0, 0, 0)

        const yesterdayEnd = new Date(yesterday)
        yesterdayEnd.setDate(yesterdayEnd.getDate() + 1)

        // Check if yesterday was a working day
        if (!isWorkingDay(yesterday, workingDays)) {
            console.log(`[Cron MarkAbsent] Yesterday (${yesterday.toISOString().split('T')[0]}) was not a working day, skipping`)
            return NextResponse.json({
                success: true,
                message: 'Yesterday was not a working day (weekend)',
                data: {
                    date: yesterday.toISOString().split('T')[0],
                    dayOfWeek: DAY_INDEX_TO_NAME[yesterday.getDay()],
                    skipped: true,
                    reason: 'weekend',
                    configuredWorkingDays: workingDays
                }
            })
        }

        // Check for holidays
        const holidays = await Holiday.find({
            isActive: true,
            $or: [
                { date: { $gte: yesterday, $lt: yesterdayEnd } },
                { date: { $lte: yesterday }, endDate: { $gte: yesterday } }
            ]
        }).lean()

        const holidayOnDay = isHoliday(yesterday, holidays)
        if (holidayOnDay) {
            console.log(`[Cron MarkAbsent] Yesterday was a holiday (${holidayOnDay.name}), skipping`)
            return NextResponse.json({
                success: true,
                message: `Yesterday was a holiday: ${holidayOnDay.name}`,
                data: {
                    date: yesterday.toISOString().split('T')[0],
                    skipped: true,
                    reason: 'holiday',
                    holiday: holidayOnDay.name
                }
            })
        }

        // Get all active employees
        const allEmployees = await Employee.find({
            status: 'active'
        }).populate('userId', '_id email firstName lastName').lean()

        console.log(`[Cron MarkAbsent] Found ${allEmployees.length} active employees`)

        // Get employees on approved leave for yesterday
        const leavesForDay = await Leave.find({
            status: 'approved',
            startDate: { $lte: yesterdayEnd },
            endDate: { $gte: yesterday }
        }).select('employee').lean()

        const onLeaveIds = new Set(leavesForDay.map(l => l.employee.toString()))
        console.log(`[Cron MarkAbsent] ${onLeaveIds.size} employees on approved leave`)

        // Get all attendance records for yesterday
        const dayAttendance = await Attendance.find({
            date: { $gte: yesterday, $lt: yesterdayEnd }
        }).lean()

        const employeesWithAttendance = new Set(dayAttendance.map(a => a.employee.toString()))
        console.log(`[Cron MarkAbsent] ${employeesWithAttendance.size} employees already have attendance records`)

        // Find employees who need to be marked absent
        const employeesToMarkAbsent = allEmployees.filter(emp => {
            const empId = emp._id.toString()

            // Skip if already has attendance record
            if (employeesWithAttendance.has(empId)) return false

            // Skip if on approved leave
            if (onLeaveIds.has(empId)) return false

            // Skip employees who hadn't joined yet
            if (emp.dateOfJoining) {
                const joiningDate = new Date(emp.dateOfJoining)
                joiningDate.setHours(0, 0, 0, 0)
                if (yesterday < joiningDate) return false
            }

            // Only process employees with user accounts
            return emp.userId
        })

        console.log(`[Cron MarkAbsent] ${employeesToMarkAbsent.length} employees to mark as absent`)

        const results = {
            date: yesterday.toISOString().split('T')[0],
            dayOfWeek: DAY_INDEX_TO_NAME[yesterday.getDay()],
            totalEmployees: allEmployees.length,
            onLeave: onLeaveIds.size,
            alreadyHadAttendance: employeesWithAttendance.size,
            marked: 0,
            notificationsSent: 0,
            notificationsFailed: 0,
            errors: 0,
            details: []
        }

        // Mark each employee as absent
        for (const employee of employeesToMarkAbsent) {
            try {
                // Create absent attendance record
                const absentRecord = new Attendance({
                    employee: employee._id,
                    date: yesterday,
                    status: 'absent',
                    workHours: 0,
                    totalLoggedHours: 0,
                    breakMinutes: 0,
                    shrinkagePercentage: 0,
                    statusReason: 'No check-in recorded',
                    remarks: 'System auto-marked absent - Daily cron job',
                    isManualEntry: false,
                    // Audit fields
                    source: 'system_auto_absent',
                    createdBySystem: true
                })

                await absentRecord.save()
                results.marked++

                // Send push notification
                if (employee.userId) {
                    try {
                        await sendPushToUser(
                            employee.userId._id,
                            {
                                title: '❌ Marked Absent',
                                body: `You have been marked absent for ${yesterday.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })} as no attendance was recorded. If this is incorrect, please raise a correction request.`,
                            },
                            {
                                eventType: 'markedAbsent',
                                clickAction: '/dashboard/attendance',
                                icon: '/icons/icon-192x192.png',
                                data: {
                                    type: 'marked-absent',
                                    date: yesterday.toISOString(),
                                    note: 'Raise correction request if this is incorrect',
                                },
                            }
                        )
                        results.notificationsSent++
                    } catch (notifyErr) {
                        console.error(`[Cron MarkAbsent] Failed to notify ${employee._id}:`, notifyErr.message)
                        results.notificationsFailed++
                    }
                }

                results.details.push({
                    employeeId: employee._id.toString(),
                    name: `${employee.firstName} ${employee.lastName}`,
                    status: 'marked_absent'
                })

            } catch (err) {
                // Handle duplicate key error (shouldn't happen but just in case)
                if (err.code === 11000) {
                    console.log(`[Cron MarkAbsent] Duplicate record for ${employee._id}, skipping`)
                    continue
                }
                console.error(`[Cron MarkAbsent] Error marking ${employee._id}:`, err.message)
                results.errors++
                results.details.push({
                    employeeId: employee._id.toString(),
                    name: `${employee.firstName} ${employee.lastName}`,
                    status: 'error',
                    error: err.message
                })
            }
        }

        const duration = Date.now() - startTime
        console.log(`[Cron MarkAbsent] Completed in ${duration}ms. Marked ${results.marked} employees as absent.`)

        // Emit socket event for real-time dashboard update
        if (global.io && results.marked > 0) {
            global.io.emit('attendance:auto-absent', {
                date: results.date,
                count: results.marked,
                timestamp: new Date().toISOString()
            })
        }

        return NextResponse.json({
            success: true,
            message: `Marked ${results.marked} employees as absent for ${results.date}`,
            data: results,
            duration: `${duration}ms`
        })

    } catch (error) {
        console.error('[Cron MarkAbsent] Fatal error:', error)
        return NextResponse.json({
            success: false,
            message: error.message,
            duration: `${Date.now() - startTime}ms`
        }, { status: 500 })
    }
}

/**
 * POST /api/cron/mark-absent
 * 
 * Manual trigger for absent marking (admin only)
 * Allows processing a specific date or date range
 * 
 * Body: {
 *   date?: string,           // Single date (YYYY-MM-DD)
 *   startDate?: string,      // Range start (YYYY-MM-DD)  
 *   endDate?: string,        // Range end (YYYY-MM-DD)
 *   sendNotifications?: boolean,  // Send push notifications (default: true)
 *   dryRun?: boolean         // Preview mode, don't actually create records
 * }
 */
export async function POST(request) {
    try {
        // Verify admin token or cron secret
        const authHeader = request.headers.get('authorization')
        const cronSecret = request.headers.get('x-cron-secret')

        const isValidCronSecret = process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET

        if (!isValidCronSecret && !authHeader) {
            return NextResponse.json(
                { success: false, message: 'Unauthorized' },
                { status: 401 }
            )
        }

        // If using auth header, verify it's an admin
        if (authHeader && !isValidCronSecret) {
            const token = authHeader.split(' ')[1]
            const { jwtVerify } = await import('jose')
            const secret = new TextEncoder().encode(process.env.JWT_SECRET)

            try {
                const { payload } = await jwtVerify(token, secret)

                await connectDB()
                const { default: User } = await import('@/models/User')
                const user = await User.findById(payload.userId).select('role')

                if (!user || !['admin', 'hr'].includes(user.role)) {
                    return NextResponse.json(
                        { success: false, message: 'Admin or HR access required' },
                        { status: 403 }
                    )
                }
            } catch (tokenErr) {
                return NextResponse.json(
                    { success: false, message: 'Invalid token' },
                    { status: 401 }
                )
            }
        }

        const body = await request.json().catch(() => ({}))
        const { date, startDate, endDate, sendNotifications = true, dryRun = false } = body

        // Forward to the mark-absent API with the cron secret
        const markAbsentUrl = new URL('/api/attendance/mark-absent', request.url)

        const response = await fetch(markAbsentUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-cron-secret': process.env.CRON_SECRET || 'internal'
            },
            body: JSON.stringify({ date, startDate, endDate, sendNotifications, dryRun })
        })

        const result = await response.json()
        return NextResponse.json(result, { status: response.status })

    } catch (error) {
        console.error('[Cron MarkAbsent POST] Error:', error)
        return NextResponse.json({
            success: false,
            message: error.message
        }, { status: 500 })
    }
}
