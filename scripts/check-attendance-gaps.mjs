import 'dotenv/config';
import mongoose from 'mongoose';

const EMPLOYEE_EMAIL = 'ankita.pandey@mushroomworldgroup.com';

const MONTHS = [
  { year: 2025, month: 0 },  // January 2025
  { year: 2025, month: 9 },  // October 2025
  { year: 2025, month: 10 }, // November 2025
  { year: 2025, month: 11 }, // December 2025
];

const CHECK_IN_HOUR = 9;
const CHECK_IN_MIN = 30;
const CHECK_OUT_HOUR = 18;
const CHECK_OUT_MIN = 30;
const WORK_HOURS = 9;

const baseUri = process.env.MONGODB_URI;
const tenantUri = baseUri.replace(/\/[^\/]*\?/, '/talio_company_mushroom_world_group?');
console.log('Connecting to tenant DB...');
await mongoose.connect(tenantUri);
console.log('Connected.');

const UserSchema = new mongoose.Schema({ email: String, employeeId: mongoose.Schema.Types.ObjectId }, { strict: false });
const EmployeeSchema = new mongoose.Schema({ firstName: String, lastName: String }, { strict: false });
const AttendanceSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  date: Date,
  checkIn: Date,
  checkOut: Date,
  status: String,
  checkInStatus: String,
  checkOutStatus: String,
  workHours: Number,
  totalLoggedHours: Number,
  overtime: Number,
  breakMinutes: Number,
  shrinkagePercentage: Number,
  source: String,
  createdBySystem: Boolean,
  isManualEntry: Boolean,
  remarks: String,
}, { timestamps: true, strict: false });

const User = mongoose.models.User || mongoose.model('User', UserSchema);
const Employee = mongoose.models.Employee || mongoose.model('Employee', EmployeeSchema);
const Attendance = mongoose.models.Attendance || mongoose.model('Attendance', AttendanceSchema);

const user = await User.findOne({ email: EMPLOYEE_EMAIL }).lean();
if (!user || !user.employeeId) {
  console.error('User/employee not found');
  await mongoose.disconnect();
  process.exit(1);
}
console.log(`Employee: ${user.employeeId}`);

// Step 1: Find all records with status != 'present' for this employee in those months
for (const { year, month } of MONTHS) {
  const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const startDate = new Date(Date.UTC(year, month, 1));
  const endDate = new Date(Date.UTC(year, month + 1, 1));
  
  // Find all existing records for this month
  const existing = await Attendance.find({
    employee: user.employeeId,
    date: { $gte: startDate, $lt: endDate },
  }).sort({ date: 1 }).lean();
  
  console.log(`\n--- ${monthName} ---`);
  console.log(`  Total records: ${existing.length}`);
  
  const presentCount = existing.filter(a => a.status === 'present').length;
  const absentCount = existing.filter(a => a.status === 'absent').length;
  const otherStatuses = existing.filter(a => a.status !== 'present' && a.status !== 'absent');
  
  console.log(`  Present: ${presentCount}, Absent: ${absentCount}`);
  if (otherStatuses.length > 0) {
    console.log(`  Other statuses:`, otherStatuses.map(a => `${a.date.toISOString().split('T')[0]}: ${a.status}`));
  }
  
  // Show absent dates
  const absentRecords = existing.filter(a => a.status === 'absent');
  if (absentRecords.length > 0) {
    console.log(`  Absent dates:`);
    for (const rec of absentRecords) {
      const d = new Date(rec.date);
      const dayName = d.toLocaleString('en-US', { weekday: 'long', timeZone: 'UTC' });
      console.log(`    ${rec.date.toISOString().split('T')[0]} (${dayName}) - status: ${rec.status}`);
    }
  }
  
  // Find all Mon-Sat dates that DON'T have any attendance record
  const existingDates = new Set(existing.map(a => a.date.toISOString().split('T')[0]));
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const missingDates = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(Date.UTC(year, month, d));
    const dow = date.getUTCDay();
    if (dow === 0) continue; // Skip Sundays only
    const dateStr = date.toISOString().split('T')[0];
    if (!existingDates.has(dateStr)) {
      missingDates.push(date);
    }
  }
  if (missingDates.length > 0) {
    console.log(`  Missing records (Mon-Sat, no record at all):`);
    for (const d of missingDates) {
      const dayName = d.toLocaleString('en-US', { weekday: 'long', timeZone: 'UTC' });
      console.log(`    ${d.toISOString().split('T')[0]} (${dayName})`);
    }
  }
}

await mongoose.disconnect();
console.log('\nDone checking.');
