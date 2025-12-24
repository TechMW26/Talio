#!/usr/bin/env node
/**
 * COMPREHENSIVE ATTENDANCE RECTIFICATION SCRIPT
 * 
 * This script ensures data consistency across Attendance records by:
 * 1. Recalculating work hours for all records with check-in and check-out
 * 2. Determining correct status based on calculated work hours
 * 3. Fixing any mismatched status values
 * 
 * This is the "nuclear option" to fix all stale data issues.
 * 
 * Usage:
 *   node scripts/rectify-all-attendance.js [--dry-run] [--date=YYYY-MM-DD] [--employee=ID]
 * 
 * Options:
 *   --dry-run      Preview changes without applying them
 *   --date         Fix only records for a specific date
 *   --employee     Fix only records for a specific employee ID
 */

require('dotenv').config()
const mongoose = require('mongoose')

const MONGODB_URI = process.env.MONGODB_URI

// Parse command line arguments
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const dateArg = args.find(a => a.startsWith('--date='))?.split('=')[1]
const employeeArg = args.find(a => a.startsWith('--employee='))?.split('=')[1]

// Schemas
const AttendanceSchema = new mongoose.Schema({
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    date: Date,
    checkIn: Date,
    checkOut: Date,
    status: String,
    workHours: Number,
    totalLoggedHours: Number,
    breakMinutes: Number,
    statusReason: String,
    source: String,
    createdBySystem: Boolean
}, { strict: false })

const EmployeeSchema = new mongoose.Schema({
    firstName: String,
    lastName: String
}, { strict: false })

const CompanySettingsSchema = new mongoose.Schema({
    fullDayHours: Number,
    halfDayHours: Number,
    breakTimings: [{ start: String, end: String }]
}, { strict: false })

/**
 * Calculate work hours from check-in and check-out
 */
function calculateWorkHours(checkIn, checkOut, breakTimings = []) {
    if (!checkIn || !checkOut) return 0

    const checkInTime = new Date(checkIn)
    const checkOutTime = new Date(checkOut)

    // Handle overnight shifts
    let totalMs = checkOutTime - checkInTime
    if (totalMs < 0) {
        totalMs += 24 * 60 * 60 * 1000 // Add 24 hours
    }

    const totalLoggedHours = totalMs / (1000 * 60 * 60)

    // Calculate break time
    let breakMinutes = 0
    for (const breakTiming of breakTimings) {
        if (breakTiming.start && breakTiming.end) {
            const [startHour, startMin] = breakTiming.start.split(':').map(Number)
            const [endHour, endMin] = breakTiming.end.split(':').map(Number)
            breakMinutes += (endHour * 60 + endMin) - (startHour * 60 + startMin)
        }
    }

    const effectiveWorkHours = totalLoggedHours - (breakMinutes / 60)

    return {
        totalLoggedHours: Math.max(0, totalLoggedHours),
        breakMinutes,
        effectiveWorkHours: Math.max(0, effectiveWorkHours)
    }
}

/**
 * Determine status based on work hours
 */
function determineStatus(workHours, fullDayHours = 8) {
    const fullDayThreshold = fullDayHours * 0.9  // 90% = 7.2 hours
    const halfDayThreshold = fullDayHours * 0.5  // 50% = 4 hours

    if (workHours >= fullDayThreshold) return { status: 'present', reason: `${workHours.toFixed(2)}h >= ${fullDayThreshold}h threshold` }
    if (workHours >= halfDayThreshold) return { status: 'half-day', reason: `${workHours.toFixed(2)}h >= ${halfDayThreshold}h threshold` }
    return { status: 'absent', reason: `${workHours.toFixed(2)}h < ${halfDayThreshold}h threshold` }
}

async function main() {
    console.log('========================================')
    console.log(' COMPREHENSIVE ATTENDANCE RECTIFICATION')
    console.log('========================================\n')

    if (dryRun) {
        console.log('🔍 DRY RUN MODE - No changes will be made\n')
    }
    if (dateArg) {
        console.log(`📅 Filtering by date: ${dateArg}\n`)
    }
    if (employeeArg) {
        console.log(`👤 Filtering by employee: ${employeeArg}\n`)
    }

    try {
        await mongoose.connect(MONGODB_URI)
        console.log('✅ Connected to MongoDB\n')

        const Attendance = mongoose.models.Attendance || mongoose.model('Attendance', AttendanceSchema)
        const Employee = mongoose.models.Employee || mongoose.model('Employee', EmployeeSchema)
        const CompanySettings = mongoose.models.CompanySettings || mongoose.model('CompanySettings', CompanySettingsSchema)

        // Get company settings
        const settings = await CompanySettings.findOne().lean()
        const fullDayHours = settings?.fullDayHours || 8
        const breakTimings = settings?.breakTimings || []

        console.log(`📊 Company Settings:`)
        console.log(`   Full Day Hours: ${fullDayHours}h`)
        console.log(`   Full Day Threshold (90%): ${(fullDayHours * 0.9).toFixed(1)}h`)
        console.log(`   Half Day Threshold (50%): ${(fullDayHours * 0.5).toFixed(1)}h`)
        console.log(`   Break Timings: ${breakTimings.length} defined\n`)

        // Build query
        const query = {
            checkIn: { $exists: true, $ne: null },
            checkOut: { $exists: true, $ne: null }
        }

        if (dateArg) {
            const targetDate = new Date(dateArg)
            const nextDay = new Date(targetDate)
            nextDay.setDate(nextDay.getDate() + 1)
            query.date = { $gte: targetDate, $lt: nextDay }
        }

        if (employeeArg) {
            query.employee = new mongoose.Types.ObjectId(employeeArg)
        }

        // Find all attendance records with check-in and check-out
        const records = await Attendance.find(query)
            .populate('employee', 'firstName lastName')
            .sort({ date: -1 })
            .lean()

        console.log(`Found ${records.length} attendance records with check-in/check-out\n`)

        let fixedCount = 0
        let alreadyCorrectCount = 0
        let errorCount = 0

        const summary = {
            present: { correct: 0, fixed: 0 },
            'half-day': { correct: 0, fixed: 0 },
            absent: { correct: 0, fixed: 0 }
        }

        for (const record of records) {
            try {
                const workCalc = calculateWorkHours(record.checkIn, record.checkOut, breakTimings)
                const { status: calculatedStatus, reason } = determineStatus(workCalc.effectiveWorkHours, fullDayHours)

                const currentStatus = record.status
                const employeeName = record.employee
                    ? `${record.employee.firstName} ${record.employee.lastName}`
                    : 'Unknown'
                const dateStr = record.date.toISOString().split('T')[0]

                if (currentStatus !== calculatedStatus) {
                    console.log(`📋 ${dateStr} | ${employeeName}`)
                    console.log(`   Check-in: ${new Date(record.checkIn).toLocaleTimeString('en-IN')}`)
                    console.log(`   Check-out: ${new Date(record.checkOut).toLocaleTimeString('en-IN')}`)
                    console.log(`   Work Hours: ${workCalc.effectiveWorkHours.toFixed(2)}h (logged: ${workCalc.totalLoggedHours.toFixed(2)}h)`)
                    console.log(`   Current Status: ${currentStatus} → Should be: ${calculatedStatus}`)
                    console.log(`   Reason: ${reason}`)

                    if (!dryRun) {
                        await Attendance.updateOne(
                            { _id: record._id },
                            {
                                status: calculatedStatus,
                                workHours: workCalc.effectiveWorkHours,
                                totalLoggedHours: workCalc.totalLoggedHours,
                                breakMinutes: workCalc.breakMinutes,
                                statusReason: `Auto-rectified: ${reason}`
                            }
                        )
                        console.log(`   ✅ Fixed!`)
                    } else {
                        console.log(`   🔍 Would fix (dry-run)`)
                    }

                    fixedCount++
                    if (summary[calculatedStatus]) summary[calculatedStatus].fixed++
                    console.log('')
                } else {
                    alreadyCorrectCount++
                    if (summary[calculatedStatus]) summary[calculatedStatus].correct++
                }
            } catch (err) {
                console.error(`❌ Error processing record ${record._id}: ${err.message}`)
                errorCount++
            }
        }

        console.log('========================================')
        console.log('             SUMMARY')
        console.log('========================================')
        console.log(`Total records processed: ${records.length}`)
        console.log(`Already correct: ${alreadyCorrectCount}`)
        console.log(`${dryRun ? 'To fix' : 'Fixed'}: ${fixedCount}`)
        console.log(`Errors: ${errorCount}`)
        console.log('')
        console.log('By Status:')
        console.log(`  Present:  ${summary.present.correct} correct, ${summary.present.fixed} ${dryRun ? 'to fix' : 'fixed'}`)
        console.log(`  Half-Day: ${summary['half-day'].correct} correct, ${summary['half-day'].fixed} ${dryRun ? 'to fix' : 'fixed'}`)
        console.log(`  Absent:   ${summary.absent.correct} correct, ${summary.absent.fixed} ${dryRun ? 'to fix' : 'fixed'}`)
        console.log('========================================\n')

        if (dryRun && fixedCount > 0) {
            console.log('💡 Run without --dry-run to apply fixes')
        }

    } catch (error) {
        console.error('❌ Error:', error.message)
        process.exit(1)
    } finally {
        await mongoose.disconnect()
    }
}

main()
