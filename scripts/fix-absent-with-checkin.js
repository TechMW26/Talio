#!/usr/bin/env node
/**
 * Fix Attendance Records with Incorrect Absent Status
 * 
 * This script finds attendance records that have both checkIn and checkOut times
 * but are incorrectly marked as 'absent', and updates them to the correct status.
 * 
 * Usage:
 *   node scripts/fix-absent-with-checkin.js [--dry-run]
 * 
 * Options:
 *   --dry-run    Preview changes without applying them
 */

require('dotenv').config()
const mongoose = require('mongoose')

const MONGODB_URI = process.env.MONGODB_URI

// Parse command line arguments
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

// Define schemas
const EmployeeSchema = new mongoose.Schema({
    firstName: String,
    lastName: String
}, { strict: false })

const AttendanceSchema = new mongoose.Schema({
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    date: Date,
    checkIn: Date,
    checkOut: Date,
    status: String,
    workHours: Number,
    statusReason: String,
    isManualEntry: Boolean,
    remarks: String
}, { strict: false })

async function main() {
    console.log('========================================')
    console.log('Fix Incorrect Absent Status')
    console.log('========================================\n')

    if (dryRun) {
        console.log('🔍 DRY RUN MODE - No changes will be made\n')
    }

    try {
        await mongoose.connect(MONGODB_URI)
        console.log('✅ Connected to MongoDB\n')

        // Register models
        const Employee = mongoose.models.Employee || mongoose.model('Employee', EmployeeSchema)
        const Attendance = mongoose.models.Attendance || mongoose.model('Attendance', AttendanceSchema)

        // Find attendance records that have both checkIn and checkOut but status is 'absent'
        const incorrectRecords = await Attendance.find({
            checkIn: { $exists: true, $ne: null },
            checkOut: { $exists: true, $ne: null },
            status: 'absent'
        }).populate('employee', 'firstName lastName').lean()

        console.log(`Found ${incorrectRecords.length} records with checkIn/checkOut but status='absent'\n`)

        if (incorrectRecords.length === 0) {
            console.log('No records to fix!')
            process.exit(0)
        }

        let fixedCount = 0

        for (const record of incorrectRecords) {
            const checkIn = new Date(record.checkIn)
            const checkOut = new Date(record.checkOut)
            const hoursWorked = (checkOut - checkIn) / (1000 * 60 * 60)

            // Determine correct status based on hours worked
            // Using standard thresholds: >=7h = present, >=4h = half-day, <4h = absent
            let newStatus = 'absent'
            if (hoursWorked >= 7) {
                newStatus = 'present'
            } else if (hoursWorked >= 4) {
                newStatus = 'half-day'
            }

            const employeeName = record.employee
                ? `${record.employee.firstName} ${record.employee.lastName}`
                : 'Unknown'
            const dateStr = record.date ? record.date.toISOString().split('T')[0] : 'Unknown date'
            const checkInTime = checkIn.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
            const checkOutTime = checkOut.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })

            console.log(`📅 ${dateStr} | ${employeeName}`)
            console.log(`   Check-in: ${checkInTime} | Check-out: ${checkOutTime} | Hours: ${hoursWorked.toFixed(2)}h`)
            console.log(`   Status: absent → ${newStatus}`)

            if (newStatus !== 'absent') {
                if (!dryRun) {
                    await Attendance.updateOne(
                        { _id: record._id },
                        {
                            $set: {
                                status: newStatus,
                                statusReason: `Auto-corrected from absent (${hoursWorked.toFixed(2)}h worked)`,
                                workHours: hoursWorked
                            }
                        }
                    )
                    console.log(`   ✅ Fixed!`)
                } else {
                    console.log(`   🔍 Would fix (dry-run)`)
                }
                fixedCount++
            } else {
                console.log(`   ⏭️  Skipped (correctly absent - less than 4h worked)`)
            }
            console.log('')
        }

        console.log('========================================')
        console.log('             SUMMARY')
        console.log('========================================')
        console.log(`Total records found: ${incorrectRecords.length}`)
        console.log(`Records ${dryRun ? 'to fix' : 'fixed'}: ${fixedCount}`)
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
