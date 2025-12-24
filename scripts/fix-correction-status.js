#!/usr/bin/env node
/**
 * Fix AttendanceCorrection records with incorrect appliedStatus
 * 
 * This script finds approved corrections where appliedStatus doesn't match
 * the calculated status based on appliedWorkHours, and fixes them.
 * 
 * Usage:
 *   node scripts/fix-correction-status.js [--dry-run]
 */

require('dotenv').config()
const mongoose = require('mongoose')

const MONGODB_URI = process.env.MONGODB_URI

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

// Schemas
const AttendanceCorrectionSchema = new mongoose.Schema({
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    attendance: { type: mongoose.Schema.Types.ObjectId, ref: 'Attendance' },
    status: String,
    appliedStatus: String,
    appliedWorkHours: Number,
    appliedCheckIn: Date,
    appliedCheckOut: Date
}, { strict: false })

const AttendanceSchema = new mongoose.Schema({
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    status: String,
    workHours: Number,
    checkIn: Date,
    checkOut: Date
}, { strict: false })

function determineStatus(workHours, fullDayHours = 8) {
    const fullDayThreshold = fullDayHours * 0.9  // 7.2 hours
    const halfDayThreshold = fullDayHours * 0.5  // 4 hours

    if (workHours >= fullDayThreshold) return 'present'
    if (workHours >= halfDayThreshold) return 'half-day'
    return 'absent'
}

async function main() {
    console.log('========================================')
    console.log('Fix Correction Records - appliedStatus')
    console.log('========================================\n')

    if (dryRun) {
        console.log('🔍 DRY RUN MODE - No changes will be made\n')
    }

    try {
        await mongoose.connect(MONGODB_URI)
        console.log('✅ Connected to MongoDB\n')

        const AttendanceCorrection = mongoose.models.AttendanceCorrection ||
            mongoose.model('AttendanceCorrection', AttendanceCorrectionSchema)
        const Attendance = mongoose.models.Attendance ||
            mongoose.model('Attendance', AttendanceSchema)

        // Find approved corrections with work hours
        const approvedCorrections = await AttendanceCorrection.find({
            status: 'approved',
            appliedWorkHours: { $exists: true, $gt: 0 }
        }).lean()

        console.log(`Found ${approvedCorrections.length} approved corrections with work hours\n`)

        let fixedCount = 0
        let alreadyCorrectCount = 0

        for (const correction of approvedCorrections) {
            const workHours = correction.appliedWorkHours
            const currentAppliedStatus = correction.appliedStatus
            const calculatedStatus = determineStatus(workHours)

            if (currentAppliedStatus !== calculatedStatus) {
                console.log(`📋 Correction ID: ${correction._id}`)
                console.log(`   Work Hours: ${workHours.toFixed(2)}h`)
                console.log(`   Current appliedStatus: ${currentAppliedStatus}`)
                console.log(`   Should be: ${calculatedStatus}`)

                if (!dryRun) {
                    // Update correction record
                    await AttendanceCorrection.updateOne(
                        { _id: correction._id },
                        { appliedStatus: calculatedStatus }
                    )

                    // Also update the actual attendance record if it's wrong
                    const attendance = await Attendance.findById(correction.attendance)
                    if (attendance && attendance.status !== calculatedStatus) {
                        attendance.status = calculatedStatus
                        attendance.statusReason = `Auto-fixed: ${workHours.toFixed(2)}h worked`
                        await attendance.save()
                        console.log(`   ✅ Fixed both correction and attendance records`)
                    } else {
                        console.log(`   ✅ Fixed correction record (attendance already correct)`)
                    }
                } else {
                    console.log(`   🔍 Would fix (dry-run)`)
                }

                fixedCount++
                console.log('')
            } else {
                alreadyCorrectCount++
            }
        }

        console.log('========================================')
        console.log('             SUMMARY')
        console.log('========================================')
        console.log(`Total approved corrections: ${approvedCorrections.length}`)
        console.log(`Already correct: ${alreadyCorrectCount}`)
        console.log(`${dryRun ? 'To fix' : 'Fixed'}: ${fixedCount}`)
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
