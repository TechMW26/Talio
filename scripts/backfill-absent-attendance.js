/**
 * Backfill Absent Attendance Records Script
 * 
 * This script creates absent attendance records for all past working days
 * where employees did not have any attendance record.
 * 
 * Usage:
 *   node scripts/backfill-absent-attendance.js [options]
 * 
 * Options:
 *   --start-date=YYYY-MM-DD    Start date for backfill (required)
 *   --end-date=YYYY-MM-DD      End date for backfill (defaults to yesterday)
 *   --dry-run                  Preview mode, don't create records
 *   --verbose                  Show detailed output
 *   --batch-size=N             Number of records to process per batch (default: 100)
 * 
 * Examples:
 *   node scripts/backfill-absent-attendance.js --start-date=2024-01-01 --dry-run
 *   node scripts/backfill-absent-attendance.js --start-date=2024-06-01 --end-date=2024-12-01
 *   node scripts/backfill-absent-attendance.js --start-date=2024-01-01 --verbose
 * 
 * Safety:
 *   - This script is idempotent (safe to run multiple times)
 *   - It will NOT override existing attendance records
 *   - It will NOT override approved leave records
 *   - It will NOT mark absent on holidays or weekends
 *   - It tracks and logs all changes for audit purposes
 */

const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
    startDate: null,
    endDate: null,
    dryRun: false,
    verbose: false,
    batchSize: 100
};

for (const arg of args) {
    if (arg.startsWith('--start-date=')) {
        options.startDate = arg.split('=')[1];
    } else if (arg.startsWith('--end-date=')) {
        options.endDate = arg.split('=')[1];
    } else if (arg === '--dry-run') {
        options.dryRun = true;
    } else if (arg === '--verbose') {
        options.verbose = true;
    } else if (arg.startsWith('--batch-size=')) {
        options.batchSize = parseInt(arg.split('=')[1]) || 100;
    }
}

// Validate required arguments
if (!options.startDate) {
    console.error('❌ Error: --start-date is required');
    console.log('\nUsage: node scripts/backfill-absent-attendance.js --start-date=YYYY-MM-DD [--end-date=YYYY-MM-DD] [--dry-run] [--verbose]');
    process.exit(1);
}

// Validate date formats
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
if (!dateRegex.test(options.startDate)) {
    console.error('❌ Error: Invalid start-date format. Use YYYY-MM-DD');
    process.exit(1);
}
if (options.endDate && !dateRegex.test(options.endDate)) {
    console.error('❌ Error: Invalid end-date format. Use YYYY-MM-DD');
    process.exit(1);
}

// Map day index (0-6) to day name
const DAY_INDEX_TO_NAME = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Define Schemas (simplified for script usage)
const CompanySettingsSchema = new mongoose.Schema({
    workingDays: [{ type: String }],
    checkInTime: { type: String, default: '09:00' },
    checkOutTime: { type: String, default: '18:00' }
}, { strict: false });

const CompanySchema = new mongoose.Schema({
    workingHours: {
        workingDays: [{ type: String }]
    }
}, { strict: false });

const EmployeeSchema = new mongoose.Schema({
    firstName: String,
    lastName: String,
    email: String,
    status: { type: String, default: 'active' },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    dateOfJoining: Date
}, { strict: false });

const AttendanceSchema = new mongoose.Schema({
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    date: Date,
    checkIn: Date,
    checkOut: Date,
    status: String,
    workHours: Number,
    totalLoggedHours: Number,
    breakMinutes: Number,
    shrinkagePercentage: Number,
    statusReason: String,
    remarks: String,
    isManualEntry: Boolean,
    source: String,
    createdBySystem: Boolean
}, { strict: false });

const LeaveSchema = new mongoose.Schema({
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    startDate: Date,
    endDate: Date,
    status: String
}, { strict: false });

const HolidaySchema = new mongoose.Schema({
    name: String,
    date: Date,
    endDate: Date,
    isActive: Boolean,
    type: String
}, { strict: false });

// Models
const CompanySettings = mongoose.models.CompanySettings || mongoose.model('CompanySettings', CompanySettingsSchema);
const Company = mongoose.models.Company || mongoose.model('Company', CompanySchema);
const Employee = mongoose.models.Employee || mongoose.model('Employee', EmployeeSchema);
const Attendance = mongoose.models.Attendance || mongoose.model('Attendance', AttendanceSchema);
const Leave = mongoose.models.Leave || mongoose.model('Leave', LeaveSchema);
const Holiday = mongoose.models.Holiday || mongoose.model('Holiday', HolidaySchema);

// Helper functions
function isWorkingDay(date, workingDays) {
    if (!workingDays || workingDays.length === 0) {
        const dayIndex = date.getDay();
        return dayIndex >= 1 && dayIndex <= 5;
    }
    const dayName = DAY_INDEX_TO_NAME[date.getDay()];
    return workingDays.includes(dayName);
}

function isHoliday(date, holidays) {
    const dateStart = new Date(date);
    dateStart.setHours(0, 0, 0, 0);

    for (const holiday of holidays) {
        if (!holiday.isActive) continue;

        const holidayStart = new Date(holiday.date);
        holidayStart.setHours(0, 0, 0, 0);

        const holidayEnd = holiday.endDate ? new Date(holiday.endDate) : new Date(holiday.date);
        holidayEnd.setHours(23, 59, 59, 999);

        if (dateStart >= holidayStart && dateStart <= holidayEnd) {
            return holiday;
        }
    }
    return null;
}

function formatDate(date) {
    return date.toISOString().split('T')[0];
}

async function connectDB() {
    try {
        if (mongoose.connection.readyState >= 1) return;

        const uri = process.env.MONGODB_URI;
        if (!uri) {
            throw new Error('MONGODB_URI not found in environment variables');
        }

        await mongoose.connect(uri);
        console.log('✅ MongoDB Connected');
    } catch (error) {
        console.error('❌ MongoDB connection error:', error.message);
        process.exit(1);
    }
}

async function main() {
    console.log('\n========================================');
    console.log('  BACKFILL ABSENT ATTENDANCE RECORDS');
    console.log('========================================\n');

    if (options.dryRun) {
        console.log('🔍 DRY RUN MODE - No records will be created\n');
    }

    await connectDB();

    // Get working days from database - prioritize Company model (companies collection)
    // Based on the actual database structure where workingHours.workingDays is stored in Company
    let workingDays = null;

    // First check Company model (this is where the data is actually stored based on your DB)
    const company = await Company.findOne().lean();
    console.log('🔍 Found Company document:', company ? 'Yes' : 'No');

    if (company?.workingHours?.workingDays && company.workingHours.workingDays.length > 0) {
        workingDays = company.workingHours.workingDays;
        console.log('📅 Using workingDays from Company.workingHours:', workingDays.join(', '));
    }

    // Fallback to CompanySettings if Company doesn't have workingDays
    if (!workingDays || workingDays.length === 0) {
        const companySettings = await CompanySettings.findOne().lean();
        if (companySettings?.workingDays && companySettings.workingDays.length > 0) {
            workingDays = companySettings.workingDays;
            console.log('📅 Using workingDays from CompanySettings:', workingDays.join(', '));
        }
    }

    // Final fallback to default Monday-Friday
    if (!workingDays || workingDays.length === 0) {
        workingDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
        console.log('📅 Using default workingDays (Mon-Fri)');
    }

    console.log(`\n✅ Final working days configuration: ${workingDays.join(', ')}\n`);

    // Parse dates
    const startDate = new Date(options.startDate);
    startDate.setHours(0, 0, 0, 0);

    let endDate;
    if (options.endDate) {
        endDate = new Date(options.endDate);
    } else {
        endDate = new Date();
        endDate.setDate(endDate.getDate() - 1); // Yesterday
    }
    endDate.setHours(23, 59, 59, 999);

    // Don't process future dates
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (endDate >= today) {
        endDate = new Date(today);
        endDate.setDate(endDate.getDate() - 1);
        endDate.setHours(23, 59, 59, 999);
    }

    console.log(`📆 Date range: ${formatDate(startDate)} to ${formatDate(endDate)}`);

    // Get all holidays in range
    const holidays = await Holiday.find({
        isActive: true,
        $or: [
            { date: { $gte: startDate, $lte: endDate } },
            { endDate: { $gte: startDate, $lte: endDate } },
            { date: { $lte: startDate }, endDate: { $gte: endDate } }
        ]
    }).lean();

    console.log(`🎄 Found ${holidays.length} holidays in the date range`);

    // Get all active employees
    const allEmployees = await Employee.find({
        status: 'active'
    }).lean();

    console.log(`👥 Found ${allEmployees.length} active employees\n`);

    // Stats tracking
    const stats = {
        totalDays: 0,
        workingDays: 0,
        weekends: 0,
        holidays: 0,
        recordsCreated: 0,
        recordsSkipped: 0,
        recordsWithExisting: 0,
        recordsOnLeave: 0,
        recordsNotJoined: 0,
        errors: 0,
        byDate: {}
    };

    // Process each day
    let currentDate = new Date(startDate);

    while (currentDate <= endDate) {
        stats.totalDays++;

        const dayStart = new Date(currentDate);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);

        const dateStr = formatDate(currentDate);

        // Check if working day (weekend)
        if (!isWorkingDay(currentDate, workingDays)) {
            stats.weekends++;
            if (options.verbose) {
                console.log(`⏭️  ${dateStr} - Weekend (${DAY_INDEX_TO_NAME[currentDate.getDay()]})`);
            }
            currentDate.setDate(currentDate.getDate() + 1);
            continue;
        }

        // Check if holiday
        const holidayOnDay = isHoliday(currentDate, holidays);
        if (holidayOnDay) {
            stats.holidays++;
            if (options.verbose) {
                console.log(`⏭️  ${dateStr} - Holiday (${holidayOnDay.name})`);
            }
            currentDate.setDate(currentDate.getDate() + 1);
            continue;
        }

        stats.workingDays++;

        // Get employees on approved leave for this day
        const leavesForDay = await Leave.find({
            status: 'approved',
            startDate: { $lte: dayEnd },
            endDate: { $gte: dayStart }
        }).select('employee').lean();

        const onLeaveIds = new Set(leavesForDay.map(l => l.employee.toString()));

        // Get all existing attendance records for this day
        const existingAttendance = await Attendance.find({
            date: { $gte: dayStart, $lt: dayEnd }
        }).select('employee').lean();

        const hasAttendanceIds = new Set(existingAttendance.map(a => a.employee.toString()));

        // Filter employees who need absent records
        const employeesNeedingAbsent = allEmployees.filter(emp => {
            const empId = emp._id.toString();

            // Skip if already has attendance
            if (hasAttendanceIds.has(empId)) return false;

            // Skip if on leave
            if (onLeaveIds.has(empId)) return false;

            // Skip if not yet joined
            if (emp.dateOfJoining) {
                const joiningDate = new Date(emp.dateOfJoining);
                joiningDate.setHours(0, 0, 0, 0);
                if (dayStart < joiningDate) return false;
            }

            // Skip if no user account (can't check in)
            if (!emp.userId) return false;

            return true;
        });

        // Track stats
        stats.recordsWithExisting += hasAttendanceIds.size;
        stats.recordsOnLeave += onLeaveIds.size;

        // Count not yet joined
        const notJoinedCount = allEmployees.filter(emp => {
            if (emp.dateOfJoining) {
                const joiningDate = new Date(emp.dateOfJoining);
                joiningDate.setHours(0, 0, 0, 0);
                return dayStart < joiningDate;
            }
            return false;
        }).length;
        stats.recordsNotJoined += notJoinedCount;

        stats.byDate[dateStr] = {
            existing: hasAttendanceIds.size,
            onLeave: onLeaveIds.size,
            notJoined: notJoinedCount,
            toCreate: employeesNeedingAbsent.length,
            created: 0,
            errors: 0
        };

        if (options.verbose) {
            console.log(`\n📅 ${dateStr} (${DAY_INDEX_TO_NAME[currentDate.getDay()]})`);
            console.log(`   Existing: ${hasAttendanceIds.size}, On Leave: ${onLeaveIds.size}, Not Joined: ${notJoinedCount}, To Create: ${employeesNeedingAbsent.length}`);
        }

        // Create absent records
        for (const employee of employeesNeedingAbsent) {
            try {
                if (options.dryRun) {
                    stats.recordsCreated++;
                    stats.byDate[dateStr].created++;
                    if (options.verbose) {
                        console.log(`   [DRY] Would mark ${employee.firstName} ${employee.lastName} as absent`);
                    }
                    continue;
                }

                const absentRecord = new Attendance({
                    employee: employee._id,
                    date: dayStart,
                    status: 'absent',
                    workHours: 0,
                    totalLoggedHours: 0,
                    breakMinutes: 0,
                    shrinkagePercentage: 0,
                    statusReason: 'No check-in recorded',
                    remarks: 'System auto-marked absent - Backfill script',
                    isManualEntry: false,
                    source: 'system_backfill',
                    createdBySystem: true
                });

                await absentRecord.save();
                stats.recordsCreated++;
                stats.byDate[dateStr].created++;

                if (options.verbose) {
                    console.log(`   ✓ Marked ${employee.firstName} ${employee.lastName} as absent`);
                }

            } catch (err) {
                if (err.code === 11000) {
                    // Duplicate key - record already exists
                    stats.recordsSkipped++;
                    if (options.verbose) {
                        console.log(`   ⏭️  ${employee.firstName} ${employee.lastName} - already has record`);
                    }
                } else {
                    stats.errors++;
                    stats.byDate[dateStr].errors++;
                    console.error(`   ❌ Error for ${employee.firstName} ${employee.lastName}: ${err.message}`);
                }
            }
        }

        currentDate.setDate(currentDate.getDate() + 1);
    }

    // Print summary
    console.log('\n========================================');
    console.log('             SUMMARY');
    console.log('========================================\n');

    console.log(`📆 Total days in range: ${stats.totalDays}`);
    console.log(`   - Working days: ${stats.workingDays}`);
    console.log(`   - Weekends: ${stats.weekends}`);
    console.log(`   - Holidays: ${stats.holidays}`);
    console.log('');
    console.log(`📊 Records processed:`);
    console.log(`   - Already had attendance: ${stats.recordsWithExisting}`);
    console.log(`   - On approved leave: ${stats.recordsOnLeave}`);
    console.log(`   - Not yet joined: ${stats.recordsNotJoined}`);
    console.log(`   - Marked as absent: ${stats.recordsCreated}`);
    console.log(`   - Skipped (duplicates): ${stats.recordsSkipped}`);
    console.log(`   - Errors: ${stats.errors}`);

    if (options.dryRun) {
        console.log('\n🔍 This was a DRY RUN - no records were actually created');
        console.log('   Run without --dry-run to create the records');
    }

    console.log('\n========================================\n');

    await mongoose.disconnect();
    console.log('✅ Done!\n');
}

// Run the script
main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
