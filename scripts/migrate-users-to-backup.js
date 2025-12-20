/**
 * Migration Script: Sync Existing Users to Backup Database
 * 
 * This script copies all existing users from the main database
 * to the backup database (TalioUsers).
 * 
 * Usage: node scripts/migrate-users-to-backup.js
 * 
 * Fields synced:
 * - originalUserId (User._id from main DB)
 * - email
 * - firstName (from Employee)
 * - lastName (from Employee)
 * - password (hashed)
 * - role
 */

const mongoose = require('mongoose')
const dotenv = require('dotenv')

// Load environment variables
dotenv.config()

const MONGODB_URI = process.env.MONGODB_URI
const MONGODB_BACKUP_URI = process.env.MONGODB_BACKUP_URI

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not configured')
  process.exit(1)
}

if (!MONGODB_BACKUP_URI) {
  console.error('❌ MONGODB_BACKUP_URI not configured')
  process.exit(1)
}

// User schema for main DB
const UserSchema = new mongoose.Schema({
  email: String,
  password: String,
  role: String,
  employeeId: mongoose.Schema.Types.ObjectId,
}, { collection: 'users' })

// Employee schema for main DB
const EmployeeSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  email: String,
}, { collection: 'employees' })

// Backup User schema
const BackupUserSchema = new mongoose.Schema({
  originalUserId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    unique: true,
  },
  email: String,
  firstName: String,
  lastName: String,
  password: String,
  role: String,
  createdInMainDb: Date,
  lastSyncedAt: Date,
}, { 
  timestamps: true,
  collection: 'User' 
})

async function migrateUsers() {
  console.log('🚀 Starting user migration to backup database...\n')

  let mainConn = null
  let backupConn = null

  try {
    // Connect to main database
    console.log('📡 Connecting to main database...')
    mainConn = await mongoose.createConnection(MONGODB_URI).asPromise()
    console.log('✅ Connected to main database\n')

    // Connect to backup database
    console.log('📡 Connecting to backup database...')
    backupConn = await mongoose.createConnection(MONGODB_BACKUP_URI).asPromise()
    console.log('✅ Connected to backup database\n')

    // Create models
    const User = mainConn.model('User', UserSchema)
    const Employee = mainConn.model('Employee', EmployeeSchema)
    const BackupUser = backupConn.model('User', BackupUserSchema)

    // Fetch all users with their passwords
    console.log('📊 Fetching users from main database...')
    const users = await User.find({}).select('+password').lean()
    console.log(`   Found ${users.length} users\n`)

    if (users.length === 0) {
      console.log('ℹ️  No users to migrate')
      return
    }

    // Fetch all employees for name lookup
    console.log('📊 Fetching employee data for names...')
    const employees = await Employee.find({}).lean()
    const employeeMap = {}
    employees.forEach(emp => {
      employeeMap[emp._id.toString()] = emp
    })
    console.log(`   Found ${employees.length} employees\n`)

    // Prepare backup data
    console.log('🔄 Preparing backup data...')
    const backupData = users.map(user => {
      const employee = user.employeeId ? employeeMap[user.employeeId.toString()] : null
      
      return {
        updateOne: {
          filter: { originalUserId: user._id },
          update: {
            $set: {
              originalUserId: user._id,
              email: user.email,
              firstName: employee?.firstName || '',
              lastName: employee?.lastName || '',
              password: user.password,
              role: user.role || 'employee',
              createdInMainDb: user.createdAt || new Date(),
              lastSyncedAt: new Date(),
            }
          },
          upsert: true,
        }
      }
    })

    // Bulk write to backup database
    console.log('💾 Writing to backup database...')
    const result = await BackupUser.bulkWrite(backupData)

    console.log('\n✅ Migration complete!')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log(`   Total users processed: ${users.length}`)
    console.log(`   New records created:   ${result.upsertedCount}`)
    console.log(`   Existing updated:      ${result.modifiedCount}`)
    console.log(`   Matched:               ${result.matchedCount}`)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

    // Verify by counting
    const backupCount = await BackupUser.countDocuments()
    console.log(`📊 Backup database now has ${backupCount} users\n`)

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    // Close connections
    if (mainConn) await mainConn.close()
    if (backupConn) await backupConn.close()
    console.log('🔌 Database connections closed')
  }
}

// Run migration
migrateUsers()
  .then(() => {
    console.log('\n🎉 Migration script completed successfully!')
    process.exit(0)
  })
  .catch(err => {
    console.error('\n❌ Unexpected error:', err)
    process.exit(1)
  })
