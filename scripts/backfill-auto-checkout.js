#!/usr/bin/env node

/**
 * Backfill Auto-Checkout & Attendance Rectification Script
 * 
 * This script performs two main functions:
 * 1. Auto-checkout: Finds attendance records stuck in 'in-progress' status
 *    from past days and performs auto-checkout using company's checkout time.
 * 2. Rectification: Recalculates work hours and status for all attendance
 *    records with both check-in and check-out to ensure accuracy.
 * 
 * Usage:
 *   node scripts/backfill-auto-checkout.js [options]
 * 
 * Options:
 *   --dry-run          Preview changes without saving
 *   --start-date=YYYY-MM-DD   Process from this date (default: 30 days ago)
 *   --end-date=YYYY-MM-DD     Process until this date (default: yesterday)
 *   --tenant=slug      Process specific tenant only
 *   --rectify-only     Skip auto-checkout, only run rectification
 *   --skip-rectify     Skip rectification, only run auto-checkout
 * 
 * Examples:
 *   node scripts/backfill-auto-checkout.js --dry-run
 *   node scripts/backfill-auto-checkout.js --start-date=2025-12-01
 *   node scripts/backfill-auto-checkout.js --tenant=demo-company
 *   node scripts/backfill-auto-checkout.js --rectify-only --start-date=2025-12-25
 */

require('dotenv').config()
const mongoose = require('mongoose')

// Parse command line arguments
const args = process.argv.slice(2)
const options = {
  dryRun: args.includes('--dry-run'),
  rectifyOnly: args.includes('--rectify-only'),
  skipRectify: args.includes('--skip-rectify'),
  startDate: null,
  endDate: null,
  tenantSlug: null
}

args.forEach(arg => {
  if (arg.startsWith('--start-date=')) {
    options.startDate = arg.split('=')[1]
  }
  if (arg.startsWith('--end-date=')) {
    options.endDate = arg.split('=')[1]
  }
  if (arg.startsWith('--tenant=')) {
    options.tenantSlug = arg.split('=')[1]
  }
})

// Default dates
if (!options.startDate) {
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  options.startDate = thirtyDaysAgo.toISOString().split('T')[0]
}

if (!options.endDate) {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  options.endDate = yesterday.toISOString().split('T')[0]
}

console.log('🔧 Auto-Checkout & Rectification Backfill Script')
console.log('='.repeat(50))
console.log(`Mode: ${options.dryRun ? 'DRY RUN (no changes will be saved)' : 'LIVE'}`)
console.log(`Date Range: ${options.startDate} to ${options.endDate}`)
if (options.tenantSlug) {
  console.log(`Tenant: ${options.tenantSlug}`)
}
if (options.rectifyOnly) {
  console.log(`Mode: Rectification ONLY (skipping auto-checkout)`)
}
if (options.skipRectify) {
  console.log(`Mode: Auto-checkout ONLY (skipping rectification)`)
}
console.log('')

// Connect to superadmin DB
async function connectSuperadminDB() {
  const uri = process.env.SUPERADMIN_MONGODB_URI || process.env.MONGODB_URI
  if (!uri) {
    throw new Error('MONGODB_URI or SUPERADMIN_MONGODB_URI not found in environment')
  }
  
  // Extract the superadmin database name or use talio_superadmin
  const superadminUri = uri.includes('talio_superadmin') 
    ? uri 
    : uri.replace(/\/[^/]+(\?|$)/, '/talio_superadmin$1')
  
  const conn = await mongoose.createConnection(superadminUri, {
    maxPoolSize: 5,
  }).asPromise()
  
  console.log('✅ Connected to superadmin database')
  return conn
}

// Get tenant connection
async function getTenantConnection(databaseName) {
  const baseUri = process.env.MONGODB_URI.replace(/\/[^/]+(\?|$)/, `/${databaseName}$1`)
  const conn = await mongoose.createConnection(baseUri, {
    maxPoolSize: 5,
  }).asPromise()
  return conn
}

// Calculate work hours
function calculateWorkHours(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 0
  const totalMinutes = (new Date(checkOut) - new Date(checkIn)) / (1000 * 60)
  return parseFloat((totalMinutes / 60).toFixed(2))
}

// Determine status based on work hours
function determineStatus(workHours, fullDayHours = 8) {
  const presentThreshold = fullDayHours * 0.9
  const halfDayThreshold = fullDayHours * 0.5
  
  if (workHours >= presentThreshold) return 'present'
  if (workHours >= halfDayThreshold) return 'half-day'
  return 'absent'
}

async function processBackfill() {
  try {
    const superadminConn = await connectSuperadminDB()
    
    // Get TenantCompany model from superadmin connection
    const TenantCompanySchema = new mongoose.Schema({
      name: String,
      slug: String,
      databaseName: String,
      isActive: { type: Boolean, default: true }
    }, { strict: false })
    
    const TenantCompany = superadminConn.model('TenantCompany', TenantCompanySchema)
    
    // Get tenants to process
    const query = { isActive: true }
    if (options.tenantSlug) {
      query.slug = options.tenantSlug
    }
    
    const tenants = await TenantCompany.find(query).lean()
    console.log(`📋 Found ${tenants.length} tenant(s) to process\n`)
    
    if (tenants.length === 0) {
      console.log('💡 No tenants found. Make sure you have active tenants in the talio_superadmin.tenantcompanies collection.')
    }
    
    let totalProcessed = 0
    let totalFixed = 0
    let totalRectified = 0
    let totalAlreadyCorrect = 0
    
    for (const tenant of tenants) {
      console.log(`\n📁 Processing tenant: ${tenant.name} (${tenant.slug})`)
      console.log(`   Database: ${tenant.databaseName}`)
      
      try {
        const conn = await getTenantConnection(tenant.databaseName)
        
        // Define schemas for this connection
        const AttendanceSchema = new mongoose.Schema({
          employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
          date: Date,
          checkIn: Date,
          checkOut: Date,
          status: String,
          checkOutStatus: String,
          workHours: Number,
          statusReason: String,
          remarks: String,
          autoCheckedOut: Boolean,
          autoCheckoutReason: String,
          autoCheckoutAt: Date
        }, { strict: false })
        
        const CompanySchema = new mongoose.Schema({
          timezone: String,
          workingHours: {
            checkOutTime: String,
            fullDayHours: Number
          }
        }, { strict: false })
        
        const EmployeeSchema = new mongoose.Schema({
          firstName: String,
          lastName: String,
          employeeCode: String
        }, { strict: false })
        
        const Attendance = conn.model('Attendance', AttendanceSchema)
        const Company = conn.model('Company', CompanySchema)
        const Employee = conn.model('Employee', EmployeeSchema)
        
        // Get company settings
        const company = await Company.findOne().lean()
        const checkOutTime = company?.workingHours?.checkOutTime || '18:00'
        const fullDayHours = company?.workingHours?.fullDayHours || 8
        const timezone = company?.timezone || 'Asia/Kolkata'
        
        console.log(`   Checkout Time: ${checkOutTime}, Full Day: ${fullDayHours}h, Timezone: ${timezone}`)
        
        // Find in-progress records from past days
        const startDate = new Date(options.startDate)
        startDate.setHours(0, 0, 0, 0)
        const endDate = new Date(options.endDate)
        endDate.setHours(23, 59, 59, 999)
        
        // ========== PHASE 1: AUTO-CHECKOUT ==========
        if (!options.rectifyOnly) {
          const inProgressRecords = await Attendance.find({
            date: { $gte: startDate, $lte: endDate },
            checkIn: { $exists: true, $ne: null },
            checkOut: { $exists: false },
            status: 'in-progress'
          }).populate('employee', 'firstName lastName employeeCode')
          
          console.log(`   📤 Phase 1 (Auto-Checkout): ${inProgressRecords.length} in-progress record(s)`)
          
          for (const record of inProgressRecords) {
            totalProcessed++
            
            // Calculate checkout time for this record's date
            const recordDate = new Date(record.date)
            const [checkOutHour, checkOutMin] = checkOutTime.split(':').map(Number)
            const checkoutDateTime = new Date(recordDate)
            checkoutDateTime.setHours(checkOutHour, checkOutMin, 0, 0)
            
            // If check-in was after checkout time, use check-in + 1 minute
            let finalCheckoutTime = checkoutDateTime
            if (record.checkIn > checkoutDateTime) {
              finalCheckoutTime = new Date(record.checkIn.getTime() + 60000)
            }
            
            // Calculate work hours and status
            const workHours = calculateWorkHours(record.checkIn, finalCheckoutTime)
            const status = determineStatus(workHours, fullDayHours)
            
            const employeeName = record.employee 
              ? `${record.employee.firstName} ${record.employee.lastName} (${record.employee.employeeCode})`
              : `Employee ${record.employee}`
            
            console.log(`\n      📝 ${employeeName}`)
            console.log(`         Date: ${recordDate.toISOString().split('T')[0]}`)
            console.log(`         Check In: ${record.checkIn.toISOString()}`)
            console.log(`         New Checkout: ${finalCheckoutTime.toISOString()}`)
            console.log(`         Work Hours: ${workHours.toFixed(2)}h`)
            console.log(`         New Status: ${status}`)
            
            if (!options.dryRun) {
              await Attendance.updateOne(
                { _id: record._id },
                {
                  checkOut: finalCheckoutTime,
                  checkOutStatus: 'auto-checkout',
                  workHours: workHours,
                  status: status,
                  statusReason: `Backfill auto-checkout: ${status} (${workHours.toFixed(2)}h worked)`,
                  autoCheckedOut: true,
                  autoCheckoutReason: 'midnight_cutoff',
                  autoCheckoutAt: new Date(),
                  remarks: (record.remarks || '') + ` | Backfill auto-checkout. Checkout set to ${checkOutTime}.`
                }
              )
              console.log(`         ✅ Updated`)
              totalFixed++
            } else {
              console.log(`         ⏭️  Would update (dry run)`)
            }
          }
        }
        
        // ========== PHASE 2: RECTIFICATION ==========
        if (!options.skipRectify) {
          // Find all completed attendance records for rectification
          const completedRecords = await Attendance.find({
            date: { $gte: startDate, $lte: endDate },
            checkIn: { $exists: true, $ne: null },
            checkOut: { $exists: true, $ne: null }
          }).populate('employee', 'firstName lastName employeeCode')
          
          console.log(`\n   🔧 Phase 2 (Rectification): ${completedRecords.length} completed record(s)`)
          
          for (const record of completedRecords) {
            // Calculate what the work hours and status SHOULD be
            const workHours = calculateWorkHours(record.checkIn, record.checkOut)
            const calculatedStatus = determineStatus(workHours, fullDayHours)
            
            const currentStatus = record.status
            const currentWorkHours = record.workHours || 0
            
            // Check if status OR work hours are mismatched (with 0.1h tolerance)
            const statusMismatch = currentStatus !== calculatedStatus
            const workHoursMismatch = Math.abs(currentWorkHours - workHours) > 0.1
            
            if (statusMismatch || workHoursMismatch) {
              totalRectified++
              
              const employeeName = record.employee 
                ? `${record.employee.firstName} ${record.employee.lastName}`
                : 'Unknown'
              const recordDate = new Date(record.date).toISOString().split('T')[0]
              
              console.log(`\n      🔄 ${employeeName} (${recordDate})`)
              console.log(`         Status: ${currentStatus} → ${calculatedStatus}`)
              console.log(`         Work Hours: ${currentWorkHours.toFixed(2)}h → ${workHours.toFixed(2)}h`)
              
              if (!options.dryRun) {
                await Attendance.updateOne(
                  { _id: record._id },
                  {
                    workHours: workHours,
                    status: calculatedStatus,
                    statusReason: `Auto-rectified: ${calculatedStatus} (${workHours.toFixed(2)}h worked)`
                  }
                )
                console.log(`         ✅ Rectified`)
              } else {
                console.log(`         ⏭️  Would rectify (dry run)`)
              }
            } else {
              totalAlreadyCorrect++
            }
          }
          
          console.log(`\n   📊 Rectification: ${totalAlreadyCorrect} already correct, ${totalRectified} ${options.dryRun ? 'would rectify' : 'rectified'}`)
        }
        
        await conn.close()
        
      } catch (tenantError) {
        console.error(`   ❌ Error: ${tenantError.message}`)
      }
    }
    
    console.log('\n' + '='.repeat(50))
    console.log('📊 SUMMARY')
    console.log('='.repeat(50))
    
    if (!options.rectifyOnly) {
      console.log('\n📤 Phase 1: Auto-Checkout')
      console.log(`   In-Progress Records Found: ${totalProcessed}`)
      if (options.dryRun) {
        console.log(`   Would Auto-Checkout: ${totalProcessed}`)
      } else {
        console.log(`   Auto-Checked Out: ${totalFixed}`)
      }
    }
    
    if (!options.skipRectify) {
      console.log('\n🔧 Phase 2: Rectification')
      console.log(`   Already Correct: ${totalAlreadyCorrect}`)
      if (options.dryRun) {
        console.log(`   Would Rectify: ${totalRectified}`)
      } else {
        console.log(`   Rectified: ${totalRectified}`)
      }
    }
    
    if (options.dryRun) {
      console.log('\n💡 Run without --dry-run to apply changes')
    }
    
    await superadminConn.close()
    console.log('\n✅ Script completed')
    process.exit(0)
    
  } catch (error) {
    console.error('\n❌ Fatal error:', error)
    process.exit(1)
  }
}

// Run the script
processBackfill()
