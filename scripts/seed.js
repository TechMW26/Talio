const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// ⚠️ DEVELOPMENT ONLY - This script should never run in production
if (process.env.NODE_ENV === 'production') {
  console.error('❌ ERROR: Seed script cannot run in production environment!');
  process.exit(1);
}

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/hrms_db';

// Default seed password - should be changed immediately after seeding
const SEED_PASSWORD = process.env.SEED_PASSWORD || 'ChangeMe123!';

// User Schema (simplified for seeding)
const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'hr', 'manager', 'employee'], default: 'employee' },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  isActive: { type: Boolean, default: true },
  lastLogin: Date,
}, { timestamps: true });

const EmployeeSchema = new mongoose.Schema({
  employeeCode: { type: String, required: true, unique: true },
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true },
  dateOfJoining: { type: Date, required: true },
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
  designation: { type: mongoose.Schema.Types.ObjectId, ref: 'Designation' },
  status: { type: String, default: 'active' },
}, { timestamps: true });

const DepartmentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

const DesignationSchema = new mongoose.Schema({
  title: { type: String, required: true },
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
  level: String,
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

const LeaveTypeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  daysAllowed: { type: Number, default: 0 },
  color: String,
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

async function seedDatabase() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB successfully!');

    // Get or create models
    const User = mongoose.models.User || mongoose.model('User', UserSchema);
    const Employee = mongoose.models.Employee || mongoose.model('Employee', EmployeeSchema);
    const Department = mongoose.models.Department || mongoose.model('Department', DepartmentSchema);
    const Designation = mongoose.models.Designation || mongoose.model('Designation', DesignationSchema);
    const LeaveType = mongoose.models.LeaveType || mongoose.model('LeaveType', LeaveTypeSchema);

    // Clear existing data (optional - comment out if you want to keep existing data)
    console.log('🗑️  Clearing existing data...');
    await User.deleteMany({});
    await Employee.deleteMany({});
    await Department.deleteMany({});
    await Designation.deleteMany({});
    await LeaveType.deleteMany({});

    // Create departments
    console.log('🏢 Creating departments...');
    const departments = await Department.insertMany([
      { name: 'Engineering', description: 'Software development and engineering', isActive: true },
      { name: 'Human Resources', description: 'HR and people operations', isActive: true },
      { name: 'Sales', description: 'Sales and business development', isActive: true },
      { name: 'Marketing', description: 'Marketing and communications', isActive: true },
      { name: 'Finance', description: 'Finance and accounting', isActive: true },
    ]);
    console.log('✅ Departments created successfully!');

    // Create designations
    console.log('💼 Creating designations...');
    const designations = await Designation.insertMany([
      { title: 'Software Engineer', department: departments[0]._id, level: 'Mid', isActive: true },
      { title: 'Senior Software Engineer', department: departments[0]._id, level: 'Senior', isActive: true },
      { title: 'HR Manager', department: departments[1]._id, level: 'Manager', isActive: true },
      { title: 'Sales Executive', department: departments[2]._id, level: 'Junior', isActive: true },
      { title: 'Marketing Manager', department: departments[3]._id, level: 'Manager', isActive: true },
    ]);
    console.log('✅ Designations created successfully!');

    // Create leave types
    console.log('🏖️  Creating leave types...');
    await LeaveType.insertMany([
      { name: 'Casual Leave', description: 'For personal reasons', daysAllowed: 12, color: '#3B82F6', isActive: true },
      { name: 'Sick Leave', description: 'For medical reasons', daysAllowed: 10, color: '#EF4444', isActive: true },
      { name: 'Paid Time Off', description: 'Vacation leave', daysAllowed: 15, color: '#10B981', isActive: true },
      { name: 'Maternity Leave', description: 'For maternity', daysAllowed: 90, color: '#F59E0B', isActive: true },
      { name: 'Paternity Leave', description: 'For paternity', daysAllowed: 15, color: '#8B5CF6', isActive: true },
    ]);
    console.log('✅ Leave types created successfully!');

    // Create employees
    console.log('👥 Creating employees...');

    const adminEmployee = await Employee.create({
      employeeCode: 'EMP001',
      firstName: 'Admin',
      lastName: 'User',
      email: 'admin@hrms.com',
      phone: '1234567890',
      dateOfJoining: new Date('2024-01-01'),
      department: departments[0]._id,
      designation: designations[1]._id,
      status: 'active',
    });

    const hrEmployee = await Employee.create({
      employeeCode: 'EMP002',
      firstName: 'HR',
      lastName: 'Manager',
      email: 'hr@hrms.com',
      phone: '1234567891',
      dateOfJoining: new Date('2024-01-01'),
      department: departments[1]._id,
      designation: designations[2]._id,
      status: 'active',
    });

    const managerEmployee = await Employee.create({
      employeeCode: 'EMP003',
      firstName: 'Team',
      lastName: 'Manager',
      email: 'manager@hrms.com',
      phone: '1234567892',
      dateOfJoining: new Date('2024-01-15'),
      department: departments[2]._id,
      designation: designations[3]._id,
      status: 'active',
    });

    const employeeUser = await Employee.create({
      employeeCode: 'EMP004',
      firstName: 'John',
      lastName: 'Doe',
      email: 'employee@hrms.com',
      phone: '1234567893',
      dateOfJoining: new Date('2024-02-01'),
      department: departments[0]._id,
      designation: designations[0]._id,
      status: 'active',
    });

    console.log('✅ Employees created successfully!');

    // Create users with hashed passwords
    console.log('🔐 Creating users with secure passwords...');
    const hashedPassword = await bcrypt.hash(SEED_PASSWORD, 12);

    await User.create({
      email: 'admin@hrms.com',
      password: hashedPassword,
      role: 'admin',
      employeeId: adminEmployee._id,
      isActive: true,
      forcePasswordChange: true, // Force password change on first login
    });

    await User.create({
      email: 'hr@hrms.com',
      password: hashedPassword,
      role: 'hr',
      employeeId: hrEmployee._id,
      isActive: true,
      forcePasswordChange: true, // Force password change on first login
    });

    await User.create({
      email: 'manager@hrms.com',
      password: hashedPassword,
      role: 'manager',
      employeeId: managerEmployee._id,
      isActive: true,
      forcePasswordChange: true, // Force password change on first login
    });

    await User.create({
      email: 'employee@hrms.com',
      password: hashedPassword,
      role: 'employee',
      employeeId: employeeUser._id,
      isActive: true,
      forcePasswordChange: true, // Force password change on first login
    });

    console.log('✅ Users created successfully!');

    console.log('\n🎉 Database seeded successfully!\n');
    console.log('📝 Login Credentials:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('⚠️  All users have the same password set via SEED_PASSWORD env var');
    console.log('⚠️  Default password: ChangeMe123! (CHANGE IMMEDIATELY!)');
    console.log('⚠️  Users will be forced to change password on first login!');
    console.log('');
    console.log('👤 Admin: admin@hrms.com');
    console.log('👤 HR Manager: hr@hrms.com');
    console.log('👤 Team Manager: manager@hrms.com');
    console.log('👤 Employee: employee@hrms.com');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n🚀 You can now login at: http://localhost:3000\n');
    console.log('⚠️  IMPORTANT: All users must change their password on first login!\n');

  } catch (error) {
    console.error('❌ Error seeding database:', error);
  } finally {
    await mongoose.connection.close();
    console.log('👋 Database connection closed');
    process.exit(0);
  }
}

// Run the seed function
seedDatabase();

