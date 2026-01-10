#!/usr/bin/env node
/**
 * Fix Check-in/Check-out Status Based on Company Timezone
 * 
 * This script recalculates the checkInStatus and checkOutStatus for all attendance records
 * using the company's timezone and office hours settings.
 * 
 * Usage:
 *   node scripts/fix-checkin-status.js [--dry-run] [--start-date=YYYY-MM-DD] [--end-date=YYYY-MM-DD]
 * 
 * Options:
 *   --dry-run         Preview changes without modifying the database
 *   --start-date      Start date for records to process (default: 30 days ago)
 *   --end-date        End date for records to process (default: today)
 *   --tenant          Process specific tenant only (by slug)
 * 
 * Examples:
 *   node scripts/fix-checkin-status.js --dry-run
 *   node scripts/fix-checkin-status.js --start-date=2026-01-01
 *   node scripts/fix-checkin-status.js --tenant=mushroom-world-group
 */

require('dotenv').config()
const mongoose = require('mongoose')

// Parse command line arguments
const args = process.argv.slice(2)
const options = {
  dryRun: args.includes('--dry-run'),
  startDate: args.find(a => a.startsWith('--start-date='))?.split('=')[1],
  endDate: args.find(a => a.startsWith('--end-date='))?.split('=')[1],
  tenant: args.find(a => a.startsWith('--tenant='))?.split('=')[1],
}

// Default timezone
const DEFAULT_TIMEZONE = 'Asia/Kolkata'

/**
 * Get timezone-aware date
 */
function toTimezoneDate(date, timezone) {
  const inputDate = new Date(date)
  const dateString = inputDate.toLocaleString('en-US', { timeZone: timezone })
  return new Date(dateString)
}

/**
 * Create a time on a specific date in a timezone
 */
function createTimeInTimezone(timeString, dateRef, timezone) {
  const [hours, minutes] = timeString.split(':').map(Number)
  const refDate = toTimezoneDate(dateRef, timezone)
  refDate.setHours(hours, minutes, 0, 0)
  return refDate
}

/**
 * Compare timestamp to office hours and determine status
 */
function compareTimeToOfficeHours(timestamp, officeTime, timezone, graceMinutes = 0) {
  const timeInTz = toTimezoneDate(timestamp, timezone)
  const officeTimeDate = createTimeInTimezone(officeTime, timestamp, timezone)
  
  const diffMs = timeInTz.getTime() - officeTimeDate.getTime()
  const diffMinutes = Math.round(diffMs / 60000)
  
  let status
  if (diffMinutes < 0) {
    status = 'early'
  } else if (diffMinutes <= graceMinutes) {
    status = 'on-time'
  } else {
    status = 'late'
  }
  
  return { status, minutesDiff: diffMinutes, actualTime: timeInTz, officeTime: officeTimeDate }
}

/**
 * Get the cluster base URI (without database name)
 */
function getClusterBaseUri() {
  const uri = process.env.MONGODB_URI
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is not defined')
  }
  
  const match = uri.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)\/?([^?]*)?(\?.*)?$/)
  if (!match) {
    throw new Error('Invalid MONGODB_URI format')
  }
  
  return {
    baseUri: match[1],
    options: match[3] || ''
  }
}

/**
 * Get database URI for a specific database
 */
function getDatabaseUri(databaseName) {
  const { baseUri, options } = getClusterBaseUri()
  return `${baseUri}/${databaseName}${options}`
}

/**
 * Connect to superadmin database
 */
async function connectSuperadminDB() {
  // Use SUPERADMIN_MONGODB_URI if available, otherwise construct from MONGODB_URI
  let uri = process.env.SUPERADMIN_MONGODB_URI
  if (!uri) {
    uri = getDatabaseUri('talio_superadmin')
  }
  
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection
  }
  
  await mongoose.connect(uri, {
    maxPoolSize: 10,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 10000,
    family: 4
  })
  console.log('✅ Connected to superadmin database')
  return mongoose.connection
}

/**
 * Get tenant connection
 */
async function getTenantConnection(databaseName) {
  const uri = process.env.MONGODB_URI
  const baseUri = uri.replace(/\/[^/]+(\?|$)/, '/')
  const tenantUri = `${baseUri}${databaseName}?retryWrites=true&w=majority`
  
  const conn = await mongoose.createConnection(tenantUri).asPromise()
  return conn
}

/**
 * Process a single tenant
 */
async function processTenant(tenant, startDate, endDate) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`📦 Processing tenant: ${tenant.name} (${tenant.slug})`)
  console.log(`   Database: ${tenant.databaseName}`)
  console.log(`${'='.repeat(60)}`)
  
  const results = {
    tenantName: tenant.name,
    processed: 0,
    fixed: 0,
    alreadyCorrect: 0,
    errors: 0,
    details: []
  }
  
  let conn
  try {
    conn = await getTenantConnection(tenant.databaseName)
    
    // Define schemas
    const AttendanceSchema = new mongoose.Schema({
      employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
      date: Date,
      checkIn: Date,
      checkOut: Date,
      checkInStatus: String,
      checkOutStatus: String,
      status: String,
      workHours: Number,
    }, { strict: false })
    
    const CompanySchema = new mongoose.Schema({
      name: String,
      timezone: { type: String, default: 'Asia/Kolkata' },
      workingHours: {
        checkInTime: { type: String, default: '09:00' },
        checkOutTime: { type: String, default: '18:00' },
        lateThresholdMinutes: { type: Number, default: 15 },
      }
    }, { strict: false })
    
    const EmployeeSchema = new mongoose.Schema({
      firstName: String,
      lastName: String,
      company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
    }, { strict: false })
    
    const Attendance = conn.model('Attendance', AttendanceSchema)
    const Company = conn.model('Company', CompanySchema)
    const Employee = conn.model('Employee', EmployeeSchema)
    
    // Get all companies with their settings
    const companies = await Company.find().lean()
    const companyMap = {}
    for (const c of companies) {
      companyMap[c._id.toString()] = {
        timezone: c.timezone || DEFAULT_TIMEZONE,
        checkInTime: c.workingHours?.checkInTime || '09:00',
        checkOutTime: c.workingHours?.checkOutTime || '18:00',
        lateThreshold: c.workingHours?.lateThresholdMinutes || 15,
      }
    }
    
    console.log(`   Found ${companies.length} companies`)
    
    // Get all employees with their company
    const employees = await Employee.find().select('_id company firstName lastName').lean()
    const employeeCompanyMap = {}
    for (const e of employees) {
      employeeCompanyMap[e._id.toString()] = e.company?.toString()
    }
    
    // Query attendance records with checkIn
    const query = {
      checkIn: { $exists: true, $ne: null },
      date: {
        $gte: startDate,
        $lte: endDate
      }
    }
    
    const attendanceRecords = await Attendance.find(query)
      .populate('employee', 'firstName lastName company')
      .sort({ date: -1 })
      .lean()
    
    console.log(`   Found ${attendanceRecords.length} attendance records to process`)
    
    for (const record of attendanceRecords) {
      results.processed++
      
      try {
        // Get company settings for this employee
        const employeeCompanyId = record.employee?.company?.toString() || 
                                   employeeCompanyMap[record.employee?._id?.toString()]
        const settings = companyMap[employeeCompanyId] || {
          timezone: DEFAULT_TIMEZONE,
          checkInTime: '09:00',
          checkOutTime: '18:00',
          lateThreshold: 15
        }
        
        const updates = {}
        let needsUpdate = false
        
        // Recalculate check-in status
        if (record.checkIn) {
          const checkInComparison = compareTimeToOfficeHours(
            record.checkIn,
            settings.checkInTime,
            settings.timezone,
            settings.lateThreshold
          )
          
          if (record.checkInStatus !== checkInComparison.status) {
            updates.checkInStatus = checkInComparison.status
            needsUpdate = true
            
            const employeeName = record.employee 
              ? `${record.employee.firstName || ''} ${record.employee.lastName || ''}`.trim() 
              : 'Unknown'
            
            results.details.push({
              date: record.date,
              employee: employeeName,
              field: 'checkInStatus',
              oldValue: record.checkInStatus,
              newValue: checkInComparison.status,
              checkInTime: record.checkIn,
              officeTime: settings.checkInTime,
              diff: checkInComparison.minutesDiff
            })
          }
        }
        
        // Recalculate check-out status
        if (record.checkOut) {
          const checkOutComparison = compareTimeToOfficeHours(
            record.checkOut,
            settings.checkOutTime,
            settings.timezone,
            0 // No grace for checkout
          )
          
          // For checkout: early means left before end time
          const expectedStatus = checkOutComparison.minutesDiff < -1 ? 'early' : 'on-time'
          
          if (record.checkOutStatus !== expectedStatus) {
            updates.checkOutStatus = expectedStatus
            needsUpdate = true
            
            const employeeName = record.employee 
              ? `${record.employee.firstName || ''} ${record.employee.lastName || ''}`.trim() 
              : 'Unknown'
            
            results.details.push({
              date: record.date,
              employee: employeeName,
              field: 'checkOutStatus',
              oldValue: record.checkOutStatus,
              newValue: expectedStatus,
              checkOutTime: record.checkOut,
              officeTime: settings.checkOutTime,
              diff: checkOutComparison.minutesDiff
            })
          }
        }
        
        if (needsUpdate) {
          if (!options.dryRun) {
            await Attendance.updateOne({ _id: record._id }, { $set: updates })
          }
          results.fixed++
        } else {
          results.alreadyCorrect++
        }
        
      } catch (err) {
        console.error(`   ❌ Error processing record ${record._id}: ${err.message}`)
        results.errors++
      }
    }
    
    // Print summary for this tenant
    console.log(`\n   📊 Summary for ${tenant.name}:`)
    console.log(`      Processed: ${results.processed}`)
    console.log(`      Fixed: ${results.fixed}${options.dryRun ? ' (dry run)' : ''}`)
    console.log(`      Already Correct: ${results.alreadyCorrect}`)
    console.log(`      Errors: ${results.errors}`)
    
    // Print some examples of fixes
    if (results.details.length > 0) {
      console.log(`\n   📝 Sample fixes:`)
      for (const detail of results.details.slice(0, 5)) {
        const dateStr = new Date(detail.date).toLocaleDateString('en-IN')
        const timeStr = detail.checkInTime 
          ? new Date(detail.checkInTime).toLocaleTimeString('en-IN', { timeZone: DEFAULT_TIMEZONE })
          : new Date(detail.checkOutTime).toLocaleTimeString('en-IN', { timeZone: DEFAULT_TIMEZONE })
        console.log(`      - ${detail.employee} on ${dateStr}: ${detail.field} ${detail.oldValue} → ${detail.newValue} (${timeStr}, diff: ${detail.diff}m)`)
      }
      if (results.details.length > 5) {
        console.log(`      ... and ${results.details.length - 5} more`)
      }
    }
    
  } catch (error) {
    console.error(`   ❌ Error processing tenant: ${error.message}`)
    results.errors++
  } finally {
    if (conn) {
      await conn.close()
    }
  }
  
  return results
}

/**
 * Main function
 */
async function main() {
  console.log('\n' + '='.repeat(70))
  console.log('🔧 FIX CHECK-IN/CHECK-OUT STATUS BASED ON COMPANY TIMEZONE')
  console.log('='.repeat(70))
  
  if (options.dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made')
  }
  
  // Calculate date range
  const endDate = options.endDate ? new Date(options.endDate) : new Date()
  endDate.setHours(23, 59, 59, 999)
  
  const startDate = options.startDate 
    ? new Date(options.startDate) 
    : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000) // 30 days ago
  startDate.setHours(0, 0, 0, 0)
  
  console.log(`\n📅 Date Range: ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}`)
  
  try {
    // Connect to superadmin DB to get tenants
    await connectSuperadminDB()
    
    // Get TenantCompany model
    const TenantCompanySchema = new mongoose.Schema({
      name: String,
      slug: String,
      databaseName: String,
      isActive: Boolean
    }, { collection: 'tenantcompanies' })
    
    const TenantCompany = mongoose.model('TenantCompany', TenantCompanySchema)
    
    // Get active tenants
    let query = { isActive: true }
    if (options.tenant) {
      query.slug = options.tenant
    }
    
    const tenants = await TenantCompany.find(query).lean()
    
    if (tenants.length === 0) {
      console.log('❌ No tenants found')
      process.exit(1)
    }
    
    console.log(`\n📦 Found ${tenants.length} tenant(s) to process`)
    
    // Process each tenant
    const allResults = []
    for (const tenant of tenants) {
      const result = await processTenant(tenant, startDate, endDate)
      allResults.push(result)
    }
    
    // Print overall summary
    console.log('\n' + '='.repeat(70))
    console.log('📊 OVERALL SUMMARY')
    console.log('='.repeat(70))
    
    let totalProcessed = 0
    let totalFixed = 0
    let totalCorrect = 0
    let totalErrors = 0
    
    for (const r of allResults) {
      totalProcessed += r.processed
      totalFixed += r.fixed
      totalCorrect += r.alreadyCorrect
      totalErrors += r.errors
    }
    
    console.log(`   Total Records Processed: ${totalProcessed}`)
    console.log(`   Total Fixed: ${totalFixed}${options.dryRun ? ' (would fix - dry run)' : ''}`)
    console.log(`   Total Already Correct: ${totalCorrect}`)
    console.log(`   Total Errors: ${totalErrors}`)
    
    if (options.dryRun) {
      console.log('\n💡 Run without --dry-run to apply changes')
    } else {
      console.log('\n✅ All changes applied successfully')
    }
    
  } catch (error) {
    console.error('❌ Fatal error:', error)
    process.exit(1)
  } finally {
    await mongoose.disconnect()
  }
}

main()
