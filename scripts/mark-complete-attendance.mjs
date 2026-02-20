import 'dotenv/config';
import mongoose from 'mongoose';

const EMPLOYEE_EMAIL = 'ankita.pandey@mushroomworldgroup.com';

// Months to fill: Jan 2025, Oct 2025, Nov 2025, Dec 2025
const MONTHS = [
  { year: 2025, month: 0 },  // January 2025
  { year: 2025, month: 9 },  // October 2025
  { year: 2025, month: 10 }, // November 2025
  { year: 2025, month: 11 }, // December 2025
];

// Standard work hours: 9:30 AM to 6:30 PM IST
const CHECK_IN_HOUR = 9;
const CHECK_IN_MIN = 30;
const CHECK_OUT_HOUR = 18;
const CHECK_OUT_MIN = 30;
const WORK_HOURS = 9;

// Connect to the tenant database
const baseUri = process.env.MONGODB_URI;
const tenantUri = baseUri.replace(/\/[^\/]*\?/, '/talio_company_mushroom_world_group?');
console.log('Connecting to tenant DB...');
await mongoose.connect(tenantUri);
console.log('Connected.');

// Define minimal schemas
const UserSchema = new mongoose.Schema({ email: String, employeeId: mongoose.Schema.Types.ObjectId }, { strict: false });
const EmployeeSchema = new mongoose.Schema({ firstName: String, lastName: String }, { strict: false });
const AttendanceSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  date: { type: Date, required: true },
  checkIn: Date,
  checkOut: Date,
  status: String,
  checkInStatus: String,
  checkOutStatus: String,
  workHours: Number,
  overtime: Number,
  totalLoggedHours: Number,
  breakMinutes: Number,
  shrinkagePercentage: Number,
  source: String,
  createdBySystem: Boolean,
  isManualEntry: Boolean,
  remarks: String,
}, { timestamps: true, strict: false });
AttendanceSchema.index({ employee: 1, date: 1 }, { unique: true });

const User = mongoose.model('User', UserSchema);
const Employee = mongoose.model('Employee', EmployeeSchema);
const Attendance = mongoose.model('Attendance', AttendanceSchema);

// Find user by email
const user = await User.findOne({ email: EMPLOYEE_EMAIL }).lean();
if (!user) {
  console.error(`User not found with email: ${EMPLOYEE_EMAIL}`);
  await mongoose.disconnect();
  process.exit(1);
}
console.log(`Found user: ${user.name || user.email}, employeeId: ${user.employeeId}`);

if (!user.employeeId) {
  console.error('User has no linked employeeId');
  await mongoose.disconnect();
  process.exit(1);
}

const employee = await Employee.findById(user.employeeId).lean();
if (!employee) {
  console.error(`Employee not found with id: ${user.employeeId}`);
  await mongoose.disconnect();
  process.exit(1);
}
console.log(`Found employee: ${employee.firstName} ${employee.lastName}`);

// Get all working days (Mon-Sat) for a given month/year
function getWorkingDays(year, month) {
  const days = [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const dow = date.getDay();
    if (dow !== 0) { // Skip Sunday (0) only — Saturday is a working day
      days.push(date);
    }
  }
  return days;
}

let totalCreated = 0;
let totalSkipped = 0;
let totalErrors = 0;

for (const { year, month } of MONTHS) {
  const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  console.log(`\n--- Processing ${monthName} ---`);
  
  const workingDays = getWorkingDays(year, month);
  console.log(`  ${workingDays.length} working days found (Mon-Sat)`);
  
  for (const day of workingDays) {
    // Set date to start of day in IST (UTC+5:30)
    const dateOnly = new Date(Date.UTC(year, month, day.getDate(), 0, 0, 0));
    
    // Check-in at 9:30 AM IST = 4:00 AM UTC
    const checkIn = new Date(Date.UTC(year, month, day.getDate(), CHECK_IN_HOUR - 5, CHECK_IN_MIN - 30));
    // Check-out at 6:30 PM IST = 1:00 PM UTC
    const checkOut = new Date(Date.UTC(year, month, day.getDate(), CHECK_OUT_HOUR - 5, CHECK_OUT_MIN - 30));
    
    try {
      const existing = await Attendance.findOne({
        employee: user.employeeId,
        date: dateOnly,
      });
      
      if (existing) {
        // Update if not already 'present'
        if (existing.status !== 'present') {
          await Attendance.updateOne(
            { _id: existing._id },
            {
              $set: {
                checkIn,
                checkOut,
                status: 'present',
                checkInStatus: 'on-time',
                checkOutStatus: 'on-time',
                workHours: WORK_HOURS,
                totalLoggedHours: WORK_HOURS,
                overtime: 0,
                breakMinutes: 0,
                shrinkagePercentage: 0,
                source: 'import',
                isManualEntry: true,
                remarks: 'Bulk attendance import',
              }
            }
          );
          console.log(`  Updated: ${dateOnly.toISOString().split('T')[0]} (was ${existing.status})`);
          totalCreated++;
        } else {
          totalSkipped++;
        }
      } else {
        await Attendance.create({
          employee: user.employeeId,
          date: dateOnly,
          checkIn,
          checkOut,
          status: 'present',
          checkInStatus: 'on-time',
          checkOutStatus: 'on-time',
          workHours: WORK_HOURS,
          totalLoggedHours: WORK_HOURS,
          overtime: 0,
          breakMinutes: 0,
          shrinkagePercentage: 0,
          source: 'import',
          createdBySystem: false,
          isManualEntry: true,
          remarks: 'Bulk attendance import',
        });
        totalCreated++;
      }
    } catch (err) {
      if (err.code === 11000) {
        // Duplicate key - already exists
        totalSkipped++;
      } else {
        console.error(`  Error on ${dateOnly.toISOString().split('T')[0]}:`, err.message);
        totalErrors++;
      }
    }
  }
}

console.log(`\n=== Summary ===`);
console.log(`Created/Updated: ${totalCreated}`);
console.log(`Skipped (already present): ${totalSkipped}`);
console.log(`Errors: ${totalErrors}`);

await mongoose.disconnect();
console.log('Done.');
