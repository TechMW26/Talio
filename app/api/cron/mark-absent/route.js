import { NextResponse } from 'next/server'
import { connectSuperadminDB } from '@/lib/superadminDb'
import getTenantCompanyModel from '@/models/TenantCompany'
import { getTenantModels } from '@/lib/tenantModels'
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
 * Process mark-absent for a single tenant
 */
async function processMarkAbsentForTenant(tenant, targetDate) {
    const results = {
        tenantName: tenant.name,
        tenantSlug: tenant.slug,
        success: true,
        skipped: false,
        skipReason: null,
        marked: 0,
        notificationsSent: 0,
        notificationsFailed: 0,
        errors: 0,
        details: []
    }

    try {
        // Get tenant-specific models
        const models = await getTenantModels(tenant.databaseName, [
            'Attendance', 'Employee', 'Leave', 'Holiday', 'Company', 'CompanySettings'
        ])
        const { Attendance, Employee, Leave, Holiday, Company, CompanySettings } = models

        // Get working days from database - prioritize Company model
        let workingDays = null

        const company = await Company.findOne().lean()
        if (company?.workingHours?.workingDays && company.workingHours.workingDays.length > 0) {
            workingDays = company.workingHours.workingDays
        }

        // Fallback to CompanySettings if Company doesn't have workingDays
        if (!workingDays || workingDays.length === 0) {
            const companySettings = await CompanySettings.findOne().lean()
            if (companySettings?.workingDays && companySettings.workingDays.length > 0) {
                workingDays = companySettings.workingDays
            }
        }

        // Final fallback to default Monday-Friday
        if (!workingDays || workingDays.length === 0) {
            workingDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
        }

        // Check if target date was a working day
        if (!isWorkingDay(targetDate, workingDays)) {
            results.skipped = true
            results.skipReason = 'weekend'
            return results
        }

        const targetDateEnd = new Date(targetDate)
        targetDateEnd.setDate(targetDateEnd.getDate() + 1)

        // Check for holidays
        const holidays = await Holiday.find({
            isActive: true,
            $or: [
                { date: { $gte: targetDate, $lt: targetDateEnd } },
                { date: { $lte: targetDate }, endDate: { $gte: targetDate } }
            ]
        }).lean()

        const holidayOnDay = isHoliday(targetDate, holidays)
        if (holidayOnDay) {
            results.skipped = true
            results.skipReason = `holiday: ${holidayOnDay.name}`
            return results
        }

        // Get all active employees
        const allEmployees = await Employee.find({
            status: 'active'
        }).populate('userId', '_id email firstName lastName').lean()

        // Get employees on approved leave for target date
        const leavesForDay = await Leave.find({
            status: 'approved',
            startDate: { $lte: targetDateEnd },
            endDate: { $gte: targetDate }
        }).select('employee').lean()

        const onLeaveIds = new Set(leavesForDay.map(l => l.employee.toString()))

        // Get all attendance records for target date
        const dayAttendance = await Attendance.find({
            date: { $gte: targetDate, $lt: targetDateEnd }
        }).lean()

        const employeesWithAttendance = new Set(dayAttendance.map(a => a.employee.toString()))

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
                if (targetDate < joiningDate) return false
            }

            // Only process employees with user accounts
            return emp.userId
        })

        // Mark each employee as absent
        for (const employee of employeesToMarkAbsent) {
            try {
                // Create absent attendance record
                const absentRecord = new Attendance({
                    employee: employee._id,
                    date: targetDate,
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
                                body: `You have been marked absent for ${targetDate.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })} as no attendance was recorded. If this is incorrect, please raise a correction request.`,
                            },
                            {
                                eventType: 'markedAbsent',
                                clickAction: '/dashboard/attendance',
                                icon: '/icons/icon-192x192.png',
                                data: {
                                    type: 'marked-absent',
                                    date: targetDate.toISOString(),
                                    note: 'Raise correction request if this is incorrect',
                                },
                            }
                        )
                        results.notificationsSent++
                    } catch (notifyErr) {
                        results.notificationsFailed++
                    }
                }

                results.details.push({
                    employeeId: employee._id.toString(),
                    name: `${employee.firstName} ${employee.lastName}`,
                    status: 'marked_absent'
                })

            } catch (err) {
                // Handle duplicate key error
                if (err.code === 11000) {
                    continue
                }
                results.errors++
                results.details.push({
                    employeeId: employee._id.toString(),
                    name: `${employee.firstName} ${employee.lastName}`,
                    status: 'error',
                    error: err.message
                })
            }
        }

        return results

    } catch (error) {
        results.success = false
        results.error = error.message
        return results
    }
}

/**
 * GET /api/cron/mark-absent
 * 
 * Daily cron job to mark employees as absent who didn't check in on the previous working day.
 * This should be scheduled to run daily (preferably early morning, e.g., 12:30 AM IST).
 * 
 * MULTI-TENANT: Iterates over ALL active tenants and processes each one.
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

        const now = new Date()
        console.log(`[Cron MarkAbsent] Starting multi-tenant processing at ${now.toISOString()}`)

        // Process yesterday
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        yesterday.setHours(0, 0, 0, 0)

        // Connect to superadmin DB and get all active tenants
        await connectSuperadminDB()
        const TenantCompany = await getTenantCompanyModel()

        const activeTenants = await TenantCompany.find({
            isActive: true,
            serviceStatus: { $in: ['active', 'trial'] },
            isSetupComplete: true
        }).lean()

        console.log(`[Cron MarkAbsent] Found ${activeTenants.length} active tenants to process`)

        const allResults = {
            date: yesterday.toISOString().split('T')[0],
            dayOfWeek: DAY_INDEX_TO_NAME[yesterday.getDay()],
            tenantsProcessed: 0,
            tenantsSkipped: 0,
            totalMarked: 0,
            totalNotificationsSent: 0,
            totalNotificationsFailed: 0,
            totalErrors: 0,
            tenantResults: []
        }

        // Process each tenant
        for (const tenant of activeTenants) {
            console.log(`[Cron MarkAbsent] Processing tenant: ${tenant.name} (${tenant.slug})`)

            const tenantResult = await processMarkAbsentForTenant(tenant, yesterday)
            allResults.tenantResults.push(tenantResult)

            if (tenantResult.skipped) {
                allResults.tenantsSkipped++
            } else {
                allResults.tenantsProcessed++
                allResults.totalMarked += tenantResult.marked
                allResults.totalNotificationsSent += tenantResult.notificationsSent
                allResults.totalNotificationsFailed += tenantResult.notificationsFailed
                allResults.totalErrors += tenantResult.errors
            }
        }

        const duration = Date.now() - startTime
        console.log(`[Cron MarkAbsent] Completed in ${duration}ms. Processed ${allResults.tenantsProcessed} tenants, marked ${allResults.totalMarked} employees as absent.`)

        // Emit socket event for real-time dashboard update
        if (global.io && allResults.totalMarked > 0) {
            global.io.emit('attendance:auto-absent', {
                date: allResults.date,
                count: allResults.totalMarked,
                timestamp: new Date().toISOString()
            })
        }

        return NextResponse.json({
            success: true,
            message: `Processed ${allResults.tenantsProcessed} tenants, marked ${allResults.totalMarked} employees as absent for ${allResults.date}`,
            data: allResults,
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
 * Can process a specific tenant or all tenants
 * 
 * Body: {
 *   tenantSlug?: string,     // Specific tenant (optional, defaults to all)
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

                // Connect to tenant DB to verify user role
                if (!payload.databaseName) {
                    return NextResponse.json(
                        { success: false, message: 'Invalid session - please log in again' },
                        { status: 401 }
                    )
                }

                const models = await getTenantModels(payload.databaseName, ['User'])
                const user = await models.User.findById(payload.userId).select('role')

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
        const { date, startDate, endDate, sendNotifications = true, dryRun = false, tenantSlug } = body

        // Forward to the mark-absent API with the cron secret
        const markAbsentUrl = new URL('/api/attendance/mark-absent', request.url)

        const response = await fetch(markAbsentUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-cron-secret': process.env.CRON_SECRET || 'internal'
            },
            body: JSON.stringify({ date, startDate, endDate, sendNotifications, dryRun, tenantSlug })
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
